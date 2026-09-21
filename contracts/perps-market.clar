;; perps-market
;;
;; Positions and trading rules. Prices come from a pinned price-source (the
;; oracle guard in production), money movement is delegated to liquidity-pool,
;; arithmetic to position-math. This contract only orchestrates.

(use-trait price-source .price-source-trait.price-source-trait)
(use-trait storage-trait .pyth-traits-v2.storage-trait)

(define-constant ERR_NOT_ADMIN (err u7000))
(define-constant ERR_UNAPPROVED_SOURCE (err u7001))
(define-constant ERR_BAD_AMOUNT (err u7002))
(define-constant ERR_LEVERAGE (err u7003))
(define-constant ERR_UTILIZATION (err u7004))
(define-constant ERR_NO_POSITION (err u7005))
(define-constant ERR_NOT_OWNER (err u7006))
(define-constant ERR_MIN_HOLD (err u7007))
(define-constant ERR_NOT_LIQUIDATABLE (err u7008))

(define-constant BTC_FEED 0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43)

(define-constant MIN_COLLATERAL u10000)   ;; 0.0001 sBTC
(define-constant MAX_UTILIZATION_BPS u5000) ;; reserved max profit <= 50% of LP liquidity
(define-constant BPS u10000)
;; A close must use a price published at least this many seconds after the price
;; the position opened on, so open/close churn cannot skim tiny moves.
(define-constant MIN_HOLD u30)

(define-data-var admin principal tx-sender)
;; Callers pass the price source as an argument, so it must be pinned: otherwise
;; a caller could supply a source that returns any price they like.
(define-data-var pinned-source (optional principal) none)

(define-data-var next-id uint u1)
(define-data-var long-oi uint u0)
(define-data-var short-oi uint u0)

(define-map positions uint {
  owner: principal,
  long: bool,
  collateral: uint,   ;; net of the open fee
  size: uint,
  entry-price: uint,  ;; 8 decimals
  entry-time: uint,   ;; publish time of the entry price
})

(define-read-only (get-price-source) (var-get pinned-source))
(define-read-only (get-position (id uint)) (map-get? positions id))
(define-read-only (get-open-interest)
  { long: (var-get long-oi), short: (var-get short-oi) })

(define-public (set-price-source (source principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR_NOT_ADMIN)
    (ok (var-set pinned-source (some source)))))

(define-public (open-position (long bool) (collateral uint) (size uint) (source <price-source>) (storage <storage-trait>))
  (begin
    (try! (require-pinned source))
    (open-pinned long collateral size source storage)))

(define-private (open-pinned (long bool) (collateral uint) (size uint) (source <price-source>) (storage <storage-trait>))
  (let (
      (fee (contract-call? .position-math fee-of size))
      (net (- collateral fee))
      (id (var-get next-id))
    )
    (asserts! (>= collateral MIN_COLLATERAL) ERR_BAD_AMOUNT)
    (asserts! (contract-call? .position-math is-leverage-allowed collateral size) ERR_LEVERAGE)
    (asserts! (within-utilization (contract-call? .position-math max-profit-reserve net)) ERR_UTILIZATION)
    (let ((quote (try! (contract-call? source get-safe-price BTC_FEED storage))))
    (try! (contract-call? .liquidity-pool take-collateral tx-sender collateral fee
            (contract-call? .position-math max-profit-reserve net)))
    (map-set positions id {
      owner: tx-sender, long: long, collateral: net, size: size,
      entry-price: (get price quote), entry-time: (get publish-time quote),
    })
    (var-set next-id (+ id u1))
    (if long
      (var-set long-oi (+ (var-get long-oi) size))
      (var-set short-oi (+ (var-get short-oi) size)))
    (ok id))))

(define-public (close-position (id uint) (source <price-source>) (storage <storage-trait>))
  (begin
    (try! (require-pinned source))
    (let (
        (pos (unwrap! (map-get? positions id) ERR_NO_POSITION))
        (quote (try! (contract-call? source get-safe-price BTC_FEED storage)))
      )
      (asserts! (is-eq tx-sender (get owner pos)) ERR_NOT_OWNER)
      (asserts! (>= (get publish-time quote) (+ (get entry-time pos) MIN_HOLD)) ERR_MIN_HOLD)
      (settle-position id pos (get owner pos) (payout-at pos (get price quote))))))

;; Anyone may liquidate a position that has lost enough of its collateral. The
;; liquidator earns a reward; the remainder stays with LPs. No minimum hold: a
;; liquidation must be possible as soon as the guarded price says so.
(define-public (liquidate (id uint) (source <price-source>) (storage <storage-trait>))
  (begin
    (try! (require-pinned source))
    (let (
        (pos (unwrap! (map-get? positions id) ERR_NO_POSITION))
        (quote (try! (contract-call? source get-safe-price BTC_FEED storage)))
        (result (contract-call? .position-math pnl (get long pos) (get collateral pos) (get size pos) (get entry-price pos) (get price quote)))
      )
      (asserts! (contract-call? .position-math is-liquidatable (get favorable result) (get amount result) (get collateral pos))
                ERR_NOT_LIQUIDATABLE)
      (settle-position id pos tx-sender (contract-call? .position-math liquidation-reward (get collateral pos))))))

;; What the trader is owed if the position closes at `price`.
(define-private (payout-at
    (pos { owner: principal, long: bool, collateral: uint, size: uint, entry-price: uint, entry-time: uint })
    (price uint))
  (let ((result (contract-call? .position-math pnl (get long pos) (get collateral pos) (get size pos) (get entry-price pos) price)))
    (contract-call? .position-math payout (get favorable result) (get amount result) (get collateral pos)
      (contract-call? .position-math fee-of (get size pos)))))

;; Remove the position and have the pool pay `payout` to `recipient`.
(define-private (settle-position
    (id uint)
    (pos { owner: principal, long: bool, collateral: uint, size: uint, entry-price: uint, entry-time: uint })
    (recipient principal)
    (payout uint))
  (begin
    (try! (contract-call? .liquidity-pool settle recipient (get collateral pos)
            (contract-call? .position-math max-profit-reserve (get collateral pos)) payout))
    (map-delete positions id)
    (if (get long pos)
      (var-set long-oi (- (var-get long-oi) (get size pos)))
      (var-set short-oi (- (var-get short-oi) (get size pos))))
    (ok payout)))

;; Would reserving `extra` more max-profit keep utilization within the cap?
(define-private (within-utilization (extra uint))
  (let ((pool (contract-call? .liquidity-pool get-pool)))
    (<= (* (+ (get reserved pool) extra) BPS) (* (get liquidity pool) MAX_UTILIZATION_BPS))))

(define-private (require-pinned (source <price-source>))
  (ok (asserts! (is-eq (some (contract-of source)) (var-get pinned-source)) ERR_UNAPPROVED_SOURCE)))
