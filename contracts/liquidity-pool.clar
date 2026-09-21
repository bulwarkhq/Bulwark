;; liquidity-pool
;;
;; Custody and accounting for the perps market. It knows nothing about prices or
;; positions: it holds sBTC, mints and burns LP shares, and keeps three numbers
;; honest (LP liquidity, locked trader collateral, reserved max-profit liability).
;;
;; Invariant: sBTC balance of this contract == liquidity + locked.
;; Token: the sBTC contract is hard-wired; swap the principal at deployment.

(define-constant ERR_BAD_AMOUNT (err u9002))
(define-constant ERR_INITIAL_LIQUIDITY (err u9003))

;; A tiny first deposit followed by a donation can round later LPs' shares to
;; zero; a floor on the first deposit makes that attack uneconomic.
(define-constant MIN_INITIAL_LIQUIDITY u1000000)

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

(define-read-only (get-shares (who principal))
  (default-to u0 (map-get? shares who)))

(define-public (add-liquidity (amount uint))
  (let ((minted amount))
    (asserts! (> amount u0) ERR_BAD_AMOUNT)
    (asserts! (>= amount MIN_INITIAL_LIQUIDITY) ERR_INITIAL_LIQUIDITY)
    (try! (contract-call? .mock-sbtc transfer amount tx-sender (as-contract tx-sender) none))
    (var-set liquidity (+ (var-get liquidity) amount))
    (var-set total-shares (+ (var-get total-shares) minted))
    (map-set shares tx-sender (+ (get-shares tx-sender) minted))
    (ok minted)))
