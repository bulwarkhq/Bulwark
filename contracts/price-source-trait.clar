;; price-source-trait
;;
;; What a consumer needs from a price provider, nothing more. Consumers depend
;; on this interface, not on oracle-guard, so any provider that honours it can
;; be plugged in (and tests can use a stub).

(use-trait storage-trait .pyth-traits-v2.storage-trait)

(define-trait price-source-trait
  (
    (get-safe-price ((buff 32) <storage-trait>)
      (response { price: uint, publish-time: uint } uint))
  )
)
