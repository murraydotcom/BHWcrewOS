# APCM/BHI manual billing batch

The Care Management Log includes a guarded workbench for preparing APCM and 2026 APCM behavioral-health add-on lines for manual entry in the approved billing system.

## Monthly workflow

1. Complete the APCM and, when furnished, BHI or CoCM care-log rows for the service month.
2. Record eligibility, current consent, coverage review, care-plan evidence, monthly requirements, the reviewed code path, provider approval, and the RCM-review release.
3. Mark each finished source row `Complete`.
4. Open **Prepare APCM/BHI batch** from the prior-month close.
5. Correct every exception. The workbench requires one APCM base row and no more than one BHI/CoCM add-on row per patient and service month.
6. Enter the billing provider, valid NPI, payer-approved service date, place of service, and approved charge for each HCPCS code.
7. Complete the final source-record and payer-rule review, then export the ready claim-entry CSV.
8. Until real-patient RCM claim creation is separately approved, use the worksheet for reviewed manual preparation only. Do not send the real-patient rows through the synthetic acceptance handoff.
9. After real-patient release is approved and an external system confirms creation, record the resulting invoice/claim reference and update the source care-log status under the existing RCM process.

## Synthetic RCM acceptance

The workbench also includes an Admin-only handoff for a separately prepared, claimable RCM encounter using reserved patient `BHW0000`.

1. In RCM, prepare a synthetic encounter with an APCM base line and a BHI or CoCM add-on, complete the governed invoice workflow, and mark the exact invoice claimable.
2. In the CrewOS batch workbench, enter that synthetic RCM encounter ID and select **Check readiness**.
3. Select **Create synthetic claim**. CrewOS sends only the BHW0000 encounter ID to the protected RCM API; it does not send the real-patient batch rows.
4. Open the RCM workflow and select **Validate with Stedi (no submission)**. The result is stored with a clearly simulated 277CA-style acknowledgment.

This acceptance path cannot create a real-patient claim. RCM also keeps `transmissionStatus` set to `blocked` after claim creation, validation, and the simulated acknowledgment.

## 2026 code pairing enforced by the workbench

- APCM base: `G0556`, `G0557`, or `G0558`.
- General BHI with APCM: `G0570`.
- Initial CoCM with APCM: `G0568`.
- Subsequent CoCM with APCM: `G0569`.

Standalone `99484`, `99492`, `99493`, and `G2214` remain separately reviewed non-APCM pathways and are not accepted as APCM add-on lines by this batch workbench.

## Boundary

The real-patient CSV is a local manual-entry worksheet containing protected billing information. It is not an official invoice, claim, 837 transaction, clearinghouse transmission, or payer submission. Store it only in BHW-approved protected storage and verify current CMS and payer requirements before external submission.

The separate BHW0000 acceptance path does create an internal synthetic claim record and Stedi-format professional-claim JSON. It calls only Stedi's validation endpoint when explicitly enabled; it has no professional-claim submission endpoint and does not create or send an 837.
