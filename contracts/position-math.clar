;; position-math
;;
;; Pure arithmetic for a sBTC-margined, sBTC-settled, linear perpetual position.
;; No state and no token movement: fees, PnL, payouts and liquidation rules.
;; Sizes and collateral are in sats; prices have 8 decimals.

(define-constant BPS u10000)
(define-constant FEE_BPS u10)         ;; 0.10% of size, charged on open and on close
(define-constant MAX_PROFIT_MULT u3)  ;; profit is capped at 3x collateral
(define-constant MAX_LEVERAGE u5)
(define-constant LIQ_LOSS_BPS u9000)  ;; liquidatable once 90% of collateral is lost
(define-constant LIQ_REWARD_BPS u500) ;; liquidator earns 5% of collateral

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

;; What the trader receives on close. The fee comes out of whatever the trader
;; is owed, and never exceeds it.
(define-read-only (payout (favorable bool) (amount uint) (collateral uint) (fee uint))
  (let ((owed (if favorable (+ collateral amount) (- collateral amount))))
    (- owed (min-uint fee owed))))

(define-read-only (is-liquidatable (favorable bool) (amount uint) (collateral uint))
  (and (not favorable)
       (>= (* amount BPS) (* collateral LIQ_LOSS_BPS))))

(define-read-only (liquidation-reward (collateral uint))
  (/ (* collateral LIQ_REWARD_BPS) BPS))

;; The most the pool could ever owe this position: what LPs must keep set aside.
(define-read-only (max-profit-reserve (collateral uint))
  (* collateral MAX_PROFIT_MULT))

(define-read-only (is-leverage-allowed (collateral uint) (size uint))
  (and (> size u0) (<= size (* collateral MAX_LEVERAGE))))

(define-private (abs-diff (a uint) (b uint))
  (if (> a b) (- a b) (- b a)))

(define-private (min-uint (a uint) (b uint))
  (if (< a b) a b))
