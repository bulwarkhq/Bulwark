;; Test-only sBTC stand-in (8 decimals). Anyone can mint: simnet only.
(impl-trait .sip-010-trait.sip-010-trait)

(define-fungible-token sbtc)

(define-public (mint (amount uint) (recipient principal))
  (ft-mint? sbtc amount recipient))

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (or (is-eq tx-sender sender) (is-eq contract-caller sender)) (err u4))
    (ft-transfer? sbtc amount sender recipient)))

(define-read-only (get-name) (ok "Mock sBTC"))
(define-read-only (get-symbol) (ok "sBTC"))
(define-read-only (get-decimals) (ok u8))
(define-read-only (get-balance (who principal)) (ok (ft-get-balance sbtc who)))
(define-read-only (get-total-supply) (ok (ft-get-supply sbtc)))
(define-read-only (get-token-uri) (ok none))
