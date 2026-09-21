;; naive-price-source  (TEST FIXTURE, intentionally vulnerable. Never deploy.)
;;
;; Reads Pyth the way a careless integrator would, which is the usage pattern
;; behind the Velar PerpDEX exploit:
;;   mode 0: pyth-storage `read`                            -> no staleness check at all
;;   mode 1: pyth-storage `read-price-with-staleness-check` -> one loose, global window
;; and nothing else: no per-feed max age, no confidence check, no ema sanity
;; check, no ordering, no circuit breaker. It exists so tests can run the exact
;; same market against a careless source and against oracle-guard.
(impl-trait .price-source-trait.price-source-trait)
(use-trait storage-trait .pyth-traits-v2.storage-trait)

(define-data-var mode uint u0)

(define-public (set-mode (new-mode uint))
  (ok (var-set mode new-mode)))

(define-public (get-safe-price (feed (buff 32)) (storage <storage-trait>))
  (let ((entry (if (is-eq (var-get mode) u0)
                 (try! (contract-call? storage read feed))
                 (try! (contract-call? storage read-price-with-staleness-check feed)))))
    (ok {
      price: (try! (contract-call? .price-policy normalize (get price entry) (get expo entry))),
      publish-time: (get publish-time entry),
    })))
