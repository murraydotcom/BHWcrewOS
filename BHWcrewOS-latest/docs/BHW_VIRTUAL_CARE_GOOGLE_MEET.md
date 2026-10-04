# BHW Virtual Care — Google Meet workflow

BHW Virtual Care uses Google Meet as the video transport and the protected BHW RCM service as the clinical workflow boundary.

## Provider workflow

1. Open **Provider → Capture** and select the verified patient.
2. Set the visit window and create an appointment-specific Meet.
3. Send the join URL only through an approved patient communication channel.
4. Confirm the current signed recording/AI-transcription consent and the agreement of everyone who may be heard during this visit.
5. Open Meet and start native transcription. Leave video recording off.
6. After the conference ends and Google finishes the transcript, select **Import completed transcript**.
7. Complete provider review in **24-Hour Documentation**. The imported transcript remains a draft and is not the legal medical record.

## Data boundary

- No patient identity is included in the Google Meet space-creation request.
- CrewOS holds the appointment-specific meeting URL only inside the protected provider workflow.
- The RCM service stores a transcript-free telehealth session and metadata-only audit events.
- The imported transcript is stored only in the protected encounter packet.
- Google Workspace/Drive retention controls remain authoritative for the native transcript artifact.
- CharmHealth remains the legal medical record.

The original BHW Capture microphone workflow remains available for in-person visits and controlled fallback use. It is not used to capture the audio output of a Google Meet call.

