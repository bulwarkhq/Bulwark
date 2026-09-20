;; Local copy of the storage trait from stx-labs/stacks-pyth-bridge (pyth-traits-v2).
;; Kept byte-compatible in shape so the guard works against the real
;; SP1CGXWEAMG6P6FT04W66NVGJ7PQWMDAC19R7PJ0Y.pyth-storage-v4 on mainnet.
;; For mainnet deployment, swap the use-trait principal (see README).

(define-trait storage-trait
	(
		(read ((buff 32)) (response {
			price: int,
			conf: uint,
			expo: int,
			ema-price: int,
			ema-conf: uint,
			publish-time: uint,
			prev-publish-time: uint,
		} uint))

		(read-price-with-staleness-check ((buff 32)) (response {
			price: int,
			conf: uint,
			expo: int,
			ema-price: int,
			ema-conf: uint,
			publish-time: uint,
			prev-publish-time: uint,
		} uint))

		(write ((list 64 {
			price-identifier: (buff 32),
			price: int,
			conf: uint,
			expo: int,
			ema-price: int,
			ema-conf: uint,
			publish-time: uint,
			prev-publish-time: uint,
		})) (response (list 64 {
			price-identifier: (buff 32),
			price: int,
			conf: uint,
			expo: int,
			ema-price: int,
			ema-conf: uint,
			publish-time: uint,
			prev-publish-time: uint,
		}) uint))
	)
)
