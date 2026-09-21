;; liquidity-pool
;;
;; Custody and accounting for the perps market. It knows nothing about prices or
;; positions: it holds sBTC, mints and burns LP shares, and keeps three numbers
;; honest (LP liquidity, locked trader collateral, reserved max-profit liability).
;;
;; Invariant: sBTC balance of this contract == liquidity + locked.
;; Token: the sBTC contract is hard-wired; swap the principal at deployment.

(define-constant ERR_NOT_ADMIN (err u9000))
(define-constant ERR_NOT_MARKET (err u9001))
(define-constant ERR_BAD_AMOUNT (err u9002))
(define-constant ERR_INITIAL_LIQUIDITY (err u9003))
(define-constant ERR_NO_SHARES (err u9004))
(define-constant ERR_RESERVED (err u9005))
(define-constant ERR_RESERVE_UNCOVERED (err u9006))

;; A tiny first deposit followed by a donation can round later LPs' shares to
;; zero; a floor on the first deposit makes that attack uneconomic.
(define-constant MIN_INITIAL_LIQUIDITY u1000000)

(define-data-var admin principal tx-sender)
;; The only caller allowed to move trader collateral in and out.
(define-data-var market (optional principal) none)

(define-data-var liquidity uint u0)
(define-data-var total-shares uint u0)
(define-data-var locked uint u0)
(define-data-var reserved uint u0)

(define-map shares principal uint)

(define-read-only (get-pool)
  {
    liquidity: (var-get liquidity),
    total-shares: (var-get total-shares),
    locked: (var-get locked),
    reserved: (var-get reserved),
  })

(define-read-only (get-market)
  (var-get market))

(define-public (set-market (new-market principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR_NOT_ADMIN)
    (ok (var-set market (some new-market)))))

(define-read-only (get-shares (who principal))
  (default-to u0 (map-get? shares who)))

(define-public (add-liquidity (amount uint))
  (let ((minted (shares-for amount)))
    (asserts! (> amount u0) ERR_BAD_AMOUNT)
    (asserts! (or (> (var-get total-shares) u0) (>= amount MIN_INITIAL_LIQUIDITY)) ERR_INITIAL_LIQUIDITY)
    (asserts! (> minted u0) ERR_NO_SHARES)
    (try! (contract-call? .mock-sbtc transfer amount tx-sender (as-contract tx-sender) none))
    (var-set liquidity (+ (var-get liquidity) amount))
    (var-set total-shares (+ (var-get total-shares) minted))
    (map-set shares tx-sender (+ (get-shares tx-sender) minted))
    (ok minted)))

(define-public (remove-liquidity (burn uint))
  (let (
      (recipient tx-sender)
      (amount (amount-for burn))
    )
    (asserts! (and (> burn u0) (<= burn (get-shares tx-sender))) ERR_NO_SHARES)
    (asserts! (>= (- (var-get liquidity) amount) (var-get reserved)) ERR_RESERVED)
    (map-set shares recipient (- (get-shares recipient) burn))
    (var-set total-shares (- (var-get total-shares) burn))
    (var-set liquidity (- (var-get liquidity) amount))
    (try! (as-contract (contract-call? .mock-sbtc transfer amount tx-sender recipient none)))
    (ok amount)))

;; Market only. Pull `amount` of a trader's sBTC into custody: the fee becomes LP
;; liquidity, the rest is locked collateral, and `reserve` (the most the pool
;; could owe this position) is set aside so LPs cannot withdraw it.
(define-public (take-collateral (trader principal) (amount uint) (fee uint) (reserve uint))
  (begin
    (try! (require-market))
    (asserts! (>= amount fee) ERR_BAD_AMOUNT)
    (asserts! (>= (var-get liquidity) (+ (var-get reserved) reserve)) ERR_RESERVE_UNCOVERED)
    (try! (contract-call? .mock-sbtc transfer amount trader (as-contract tx-sender) none))
    (var-set liquidity (+ (var-get liquidity) fee))
    (var-set locked (+ (var-get locked) (- amount fee)))
    (var-set reserved (+ (var-get reserved) reserve))
    (ok true)))

(define-private (require-market)
  (ok (asserts! (is-eq (some contract-caller) (var-get market)) ERR_NOT_MARKET)))

;; Shares minted for a deposit: 1:1 into an empty pool, pro-rata otherwise.
(define-private (shares-for (amount uint))
  (if (is-eq (var-get total-shares) u0)
    amount
    (/ (* amount (var-get total-shares)) (var-get liquidity))))

;; sBTC owed for burning shares.
(define-private (amount-for (burn uint))
  (if (is-eq (var-get total-shares) u0)
    u0
    (/ (* burn (var-get liquidity)) (var-get total-shares))))
