;; position-math
;;
;; Pure arithmetic for a sBTC-margined, sBTC-settled, linear perpetual position.
;; No state and no token movement: fees, PnL, payouts and liquidation rules.
;; Sizes and collateral are in sats; prices have 8 decimals.

(define-constant BPS u10000)
(define-constant FEE_BPS u10)         ;; 0.10% of size, charged on open and on close
(define-constant MAX_PROFIT_MULT u3)  ;; profit is capped at 3x collateral

(define-read-only (fee-of (size uint))
  (/ (* size FEE_BPS) BPS))

;; Profit or loss of a position, already capped: profit <= 3x collateral,
;; loss <= collateral. `favorable` says which side of zero it is on.
(define-read-only (pnl (long bool) (collateral uint) (size uint) (entry-price uint) (price uint))
  (let (
      (raw (/ (* size (abs-diff price entry-price)) entry-price))
      (favorable (if long (> price entry-price) (< price entry-price)))
    )
    (if favorable
      { favorable: true, amount: (min-uint raw (* collateral MAX_PROFIT_MULT)) }
      { favorable: false, amount: (min-uint raw collateral) })))

(define-private (abs-diff (a uint) (b uint))
  (if (> a b) (- a b) (- b a)))

(define-private (min-uint (a uint) (b uint))
  (if (< a b) a b))
