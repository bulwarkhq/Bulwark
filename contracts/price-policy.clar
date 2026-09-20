;; price-policy
;;
;; Pure, stateless rules for judging a Pyth price. No storage, no admin, no
;; clock reads: every input is an argument, so each rule is trivially testable.
;; oracle-guard owns the state and calls into this contract.

(define-constant ERR_BAD_PRICE (err u6008))
(define-constant ERR_BAD_EXPO (err u6014))

(define-constant TARGET_DECIMALS 8)

;; Scale a Pyth fixed-point price (price * 10^expo) to 8 decimals.
(define-read-only (normalize (price int) (expo int))
  (begin
    (asserts! (> price 0) ERR_BAD_PRICE)
    (asserts! (and (<= expo 0) (>= expo -18)) ERR_BAD_EXPO)
    (ok (if (>= expo (* TARGET_DECIMALS -1))
      (* (to-uint price) (pow u10 (to-uint (+ expo TARGET_DECIMALS))))
      (/ (to-uint price) (pow u10 (to-uint (- (* expo -1) TARGET_DECIMALS))))))))
