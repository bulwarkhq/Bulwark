;; oracle-guard
;;
;; Stateful front door for price reads. It owns configuration, the last accepted
;; price and the circuit breaker; every judgement about a price is delegated to
;; price-policy.

(use-trait storage-trait .pyth-traits-v2.storage-trait)

(define-constant ERR_NOT_ADMIN (err u6000))
(define-constant ERR_FEED_NOT_CONFIGURED (err u6002))
(define-constant ERR_UNAPPROVED_STORAGE (err u6011))
(define-constant ERR_BAD_CONFIG (err u6010))

(define-constant BPS u10000)

(define-data-var admin principal tx-sender)
(define-data-var approved-storage (optional principal) none)

;; max-age, step-window and cooldown are seconds; *-bps are basis points.
(define-map feeds (buff 32) {
  max-age: uint,
  max-conf-bps: uint,
  max-ema-dev-bps: uint,
  max-step-bps: uint,
  step-window: uint,
  cooldown: uint,
})

(define-read-only (get-admin)
  (var-get admin))

(define-public (set-admin (new-admin principal))
  (begin
    (try! (require-admin))
    (ok (var-set admin new-admin))))

(define-read-only (get-approved-storage)
  (var-get approved-storage))

(define-public (set-approved-storage (storage principal))
  (begin
    (try! (require-admin))
    (ok (var-set approved-storage (some storage)))))

(define-read-only (get-config (feed (buff 32)))
  (map-get? feeds feed))

(define-public (set-feed-config
    (feed (buff 32))
    (max-age uint) (max-conf-bps uint) (max-ema-dev-bps uint)
    (max-step-bps uint) (step-window uint) (cooldown uint))
  (begin
    (try! (require-admin))
    (asserts! (and (> max-age u0)
                   (<= max-conf-bps BPS)
                   (<= max-ema-dev-bps BPS)
                   (> max-step-bps u0)
                   (<= max-step-bps BPS))
              ERR_BAD_CONFIG)
    (ok (map-set feeds feed {
      max-age: max-age,
      max-conf-bps: max-conf-bps,
      max-ema-dev-bps: max-ema-dev-bps,
      max-step-bps: max-step-bps,
      step-window: step-window,
      cooldown: cooldown,
    }))))

;; The one call a consumer protocol makes instead of reading Pyth directly.
(define-public (get-safe-price (feed (buff 32)) (storage <storage-trait>))
  (let (
      (cfg (unwrap! (map-get? feeds feed) ERR_FEED_NOT_CONFIGURED))
      (entry (begin
        (try! (require-approved storage))
        (try! (contract-call? storage read feed))))
    )
    (try! (contract-call? .price-policy check-fresh (get publish-time entry) (block-time) (get max-age cfg)))
    (ok {
      price: (try! (contract-call? .price-policy normalize (get price entry) (get expo entry))),
      publish-time: (get publish-time entry),
    })))

;; Chain time as of the previous block; 0 at genesis.
(define-private (block-time)
  (if (> stacks-block-height u0)
    (default-to u0 (get-stacks-block-info? time (- stacks-block-height u1)))
    u0))

(define-private (require-approved (storage <storage-trait>))
  (ok (asserts! (is-eq (some (contract-of storage)) (var-get approved-storage)) ERR_UNAPPROVED_STORAGE)))

(define-private (require-admin)
  (ok (asserts! (is-eq tx-sender (var-get admin)) ERR_NOT_ADMIN)))
