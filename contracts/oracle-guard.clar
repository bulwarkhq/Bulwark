;; oracle-guard
;;
;; Stateful front door for price reads. It owns configuration, the last accepted
;; price and the circuit breaker; every judgement about a price is delegated to
;; price-policy.

(define-constant ERR_NOT_ADMIN (err u6000))

(define-data-var admin principal tx-sender)
(define-data-var approved-storage (optional principal) none)

(define-read-only (get-approved-storage)
  (var-get approved-storage))

(define-public (set-approved-storage (storage principal))
  (begin
    (try! (require-admin))
    (ok (var-set approved-storage (some storage)))))

(define-private (require-admin)
  (ok (asserts! (is-eq tx-sender (var-get admin)) ERR_NOT_ADMIN)))
