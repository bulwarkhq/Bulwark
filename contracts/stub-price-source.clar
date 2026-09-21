;; Test double for price-source-trait: serves whatever quote the test sets.
(impl-trait .price-source-trait.price-source-trait)
(use-trait storage-trait .pyth-traits-v2.storage-trait)

(define-data-var quote (optional { price: uint, publish-time: uint }) none)

(define-public (set-quote (price uint) (publish-time uint))
  (ok (var-set quote (some { price: price, publish-time: publish-time }))))

(define-public (get-safe-price (feed (buff 32)) (storage <storage-trait>))
  (ok (unwrap! (var-get quote) (err u1))))
