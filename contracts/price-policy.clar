;; price-policy
;;
;; Pure, stateless rules for judging a Pyth price. No storage, no admin, no
;; clock reads: every input is an argument, so each rule is trivially testable.
;; oracle-guard owns the state and calls into this contract.

(define-constant ERR_STALE (err u6003))
(define-constant ERR_FUTURE (err u6004))
(define-constant ERR_LOW_CONFIDENCE (err u6005))
(define-constant ERR_EMA_DEVIATION (err u6006))
(define-constant ERR_TIME_REGRESSION (err u6009))
(define-constant ERR_BAD_PRICE (err u6008))
(define-constant ERR_BAD_EXPO (err u6014))

(define-constant TARGET_DECIMALS 8)
;; Pyth publish times come from Pythnet, Stacks block time is coarse: allow a
;; little skew before calling a timestamp "from the future".
(define-constant MAX_FUTURE_SECS u10)
(define-constant BPS u10000)

;; Scale a Pyth fixed-point price (price * 10^expo) to 8 decimals.
(define-read-only (normalize (price int) (expo int))
  (begin
    (asserts! (> price 0) ERR_BAD_PRICE)
    (asserts! (and (<= expo 0) (>= expo -18)) ERR_BAD_EXPO)
    (ok (if (>= expo (* TARGET_DECIMALS -1))
      (* (to-uint price) (pow u10 (to-uint (+ expo TARGET_DECIMALS))))
      (/ (to-uint price) (pow u10 (to-uint (- (* expo -1) TARGET_DECIMALS))))))))

;; Reject prices that are too old, or stamped implausibly far ahead of the chain.
(define-read-only (check-fresh (publish-time uint) (block-time uint) (max-age uint))
  (begin
    (asserts! (<= publish-time (+ block-time MAX_FUTURE_SECS)) ERR_FUTURE)
    (asserts! (<= (age-of publish-time block-time) max-age) ERR_STALE)
    (ok true)))

(define-private (age-of (publish-time uint) (block-time uint))
  (if (> block-time publish-time) (- block-time publish-time) u0))

;; Reject prices whose published confidence interval is wider than max-conf-bps of the price.
(define-read-only (check-confidence (conf uint) (price uint) (max-conf-bps uint))
  (begin
    (asserts! (<= (* conf BPS) (* price max-conf-bps)) ERR_LOW_CONFIDENCE)
    (ok true)))

;; Reject prices that sit too far from Pyth's own exponential moving average.
;; A feed with no ema yet (0) cannot be judged, so it passes.
(define-read-only (check-ema-deviation (price uint) (ema uint) (max-dev-bps uint))
  (begin
    (asserts! (or (is-eq ema u0)
                  (<= (* (abs-diff price ema) BPS) (* ema max-dev-bps)))
              ERR_EMA_DEVIATION)
    (ok true)))

(define-private (abs-diff (a uint) (b uint))
  (if (> a b) (- a b) (- b a)))

;; Time must never run backwards: a price older than one already accepted is
;; how an attacker replays a favourable historical tick.
(define-read-only (check-time-order (last-publish-time uint) (publish-time uint))
  (begin
    (asserts! (>= publish-time last-publish-time) ERR_TIME_REGRESSION)
    (ok true)))
