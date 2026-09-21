;; perps-market
;;
;; Positions and trading rules. Prices come from a pinned price-source (the
;; oracle guard in production), money movement is delegated to liquidity-pool,
;; arithmetic to position-math. This contract only orchestrates.

(use-trait price-source .price-source-trait.price-source-trait)
(use-trait storage-trait .pyth-traits-v2.storage-trait)

(define-constant ERR_NOT_ADMIN (err u7000))
(define-constant ERR_UNAPPROVED_SOURCE (err u7001))

(define-constant BTC_FEED 0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43)

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
  (let (
      (quote (try! (quote-from source storage)))
      (fee (contract-call? .position-math fee-of size))
      (net (- collateral fee))
      (id (var-get next-id))
    )
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
    (ok id)))

(define-private (quote-from (source <price-source>) (storage <storage-trait>))
  (begin
    (asserts! (is-eq (some (contract-of source)) (var-get pinned-source)) ERR_UNAPPROVED_SOURCE)
    (contract-call? source get-safe-price BTC_FEED storage)))
