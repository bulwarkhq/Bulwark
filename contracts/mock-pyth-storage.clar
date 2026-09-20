;; Test-only stand-in for pyth-storage-v4.
;; Mirrors the two read paths of the real contract:
;;   read                              -> NO staleness check (what a careless integrator calls)
;;   read-price-with-staleness-check   -> loose, governance-set threshold (default 60s here)
;; Prices can be set freely with set-price to simulate any signed Pyth update.
(impl-trait .pyth-traits-v2.storage-trait)

(define-constant ERR_STALE_PRICE (err u5002))
(define-constant ERR_PRICE_FEED_NOT_FOUND (err u5004))
(define-constant STALE_THRESHOLD u60)

(define-map prices (buff 32) {
  price: int, conf: uint, expo: int, ema-price: int, ema-conf: uint,
  publish-time: uint, prev-publish-time: uint,
})

(define-public (set-price (id (buff 32)) (price int) (conf uint) (ema-price int) (publish-time uint))
  (ok (map-set prices id {
    price: price, conf: conf, expo: -8, ema-price: ema-price, ema-conf: conf,
    publish-time: publish-time, prev-publish-time: (if (> publish-time u0) (- publish-time u1) u0),
  })))

(define-read-only (now)
  (default-to u0 (get-stacks-block-info? time (- stacks-block-height u1))))

(define-public (read (id (buff 32)))
  (ok (unwrap! (map-get? prices id) ERR_PRICE_FEED_NOT_FOUND)))

(define-read-only (read-price-with-staleness-check (id (buff 32)))
  (let ((entry (unwrap! (map-get? prices id) ERR_PRICE_FEED_NOT_FOUND)))
    (asserts! (>= (get publish-time entry) (- (now) STALE_THRESHOLD)) ERR_STALE_PRICE)
    (ok entry)))

;; Unused by the guard; present to satisfy the trait.
(define-public (write (batch (list 64 {
    price-identifier: (buff 32), price: int, conf: uint, expo: int, ema-price: int,
    ema-conf: uint, publish-time: uint, prev-publish-time: uint,
  })))
  (ok batch))
