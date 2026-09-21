;; Test fixture: a minimal consumer that reads a price through the trait.
(use-trait price-source .price-source-trait.price-source-trait)
(use-trait storage-trait .pyth-traits-v2.storage-trait)

(define-public (fetch (source <price-source>) (feed (buff 32)) (storage <storage-trait>))
  (contract-call? source get-safe-price feed storage))
