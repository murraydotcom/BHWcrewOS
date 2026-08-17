# CrewHQ Encounter Note Builder

The provider Claim Laundering workflow now supports one primary note template plus multiple applicable modules. Available modules are Condition Management, Preventive Care, Controlled Medication Monitoring, Behavioral Health, and CharmEd Minds. CCM and a separate Medication Management visit template are intentionally excluded.

The source transcription remains separate from the editable structured note. The provider must review the transcription before generating a draft. Imported pre-visit and patient-master-list context is source/date labeled and cannot enter the note until it is reconciled or reviewed for note use.

After note generation, the existing documentation and Claim Laundering audit evaluates supported ICD-10-CM specificity, possible HCC relevance, applicable Z-code opportunities, and CPT/HCPCS support. Suggestions remain review-only; the system does not infer diagnoses from medications, labs, questionnaires, or historical problem-list entries.

CharmHealth remains the designated EHR during the pilot.
