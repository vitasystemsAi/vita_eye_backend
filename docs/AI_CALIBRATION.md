# AI calibration guide

VITA EYE ships with **starting** recognition thresholds. They are not certified for any site.
Before production use, measure how the model behaves on *your* cameras, lighting, mounting
height and population, then set the thresholds in **Settings → Recognition**. Re-run the
calibration whenever cameras, lenses, lighting or the model version change.

A recognition result is decision support for a trained operator. It must never by itself unlock
doors, accuse anyone, or trigger a physical intervention, and an "Unrecognized person" is
simply someone without a matching registration, not an intruder.

## 1. How a face is scored

1. **Detection** – YuNet finds faces and five landmarks (`minDetectionScore`, default 0.85).
2. **Quality gate** – the aligned crop is scored for size (`minFaceSize`, default 64 px),
   sharpness, brightness, pose and detector confidence. Crops below `minQuality` (0.5) become
   `LOW_QUALITY` and are ignored; they never count as unknown.
3. **Embedding** – SFace produces a 128-dimensional L2-normalised vector. Templates are stored
   AES-256-GCM encrypted and decrypted only inside the private network for the AI service.
4. **Matching** – cosine similarity (dot product, -1…1) against every template in the
   organization's gallery. The best person and the best *other* person are kept.
5. **Classification of one observation**

   | Condition | Label |
   |---|---|
   | best ≥ `knownThreshold` **and** best − second-best person ≥ `matchMargin` | `KNOWN` |
   | best ≥ `knownThreshold` but another person is within `matchMargin` | `UNCERTAIN` |
   | best < `unknownThreshold` (or the gallery is empty) | `UNKNOWN` |
   | anything in between | `UNCERTAIN` |

6. **Temporal verification** – faces are tracked across frames by bounding-box overlap. A track
   produces an event only after `temporalMinFrames` usable observations inside
   `temporalWindowSec`, and only if at least `temporalAgreement` of them agree. A track that keeps
   disagreeing is emitted once as `UNCERTAIN` for human review. Each track emits at most one event.
   Two fast paths keep fast-moving people from escaping: a single observation whose similarity is
   at least `knownThreshold + 0.12` confirms a `KNOWN` match immediately, and a track that leaves
   the view before reaching `temporalMinFrames` is finalised from the usable observations it has
   (`framesObserved` on the event shows how many). Tracks expire after max(1.5 s, 2.5 frame
   intervals), so these events arrive within ~1.5 s of the person leaving.
7. **Duplicate suppression** – a registered person is not re-reported on the same camera within
   `knownCooldownSec`; an unrecognized face that matches one reported within `unknownCooldownSec`
   counts as the same event. Alerts per camera are additionally limited by `alertCooldownSec`.

The same `knownThreshold` is used at enrollment: images of one person must agree with each other
(`INCONSISTENT_IDENTITY`), and a face that matches another registration is refused
(`DUPLICATE_IDENTITY`).

## 2. Default values

| Setting | Default | Effect of raising it |
|---|---|---|
| `knownThreshold` | 0.42 | Fewer false matches, more registered people shown as Uncertain |
| `unknownThreshold` | 0.28 | More faces reported as Unrecognized (including poorly captured registered people) |
| `matchMargin` | 0.05 | More look-alike pairs routed to Uncertain instead of guessed |
| `minFaceSize` | 64 px | Distant faces ignored; better accuracy on the rest |
| `minQuality` | 0.5 | Fewer low-quality observations used |
| `minDetectionScore` | 0.85 | Fewer non-face detections, more missed faces |
| `temporalMinFrames` | 3 | Slower but more reliable confirmation |
| `temporalWindowSec` | 10 | Frames must arrive within this window to be combined |
| `temporalAgreement` | 0.7 | Stricter consensus; more Uncertain results |

OpenCV documents 0.363 as the SFace same-identity cosine threshold on the LFW benchmark. LFW
photographs are far cleaner than CCTV frames, so the defaults are deliberately stricter and only
a starting point.

## 3. Calibration procedure

### 3.1 Collect a validation set

* Use the **target cameras** at their real positions, at different times of day.
* Include only people who have given informed consent for this purpose (staff volunteers are
  typical). Record the consent like any other enrollment and delete the set afterwards.
* Aim for **at least 50 identities with 10+ images each**, covering glasses, masks/caps if
  allowed on site, and the full range of ages and skin tones present in your population.
* Organise one folder per person:

  ```
  dataset/
    person_001/ 01.jpg 02.jpg …
    person_002/ …
  ```

### 3.2 Measure

```bash
cd ai-service
python scripts/calibrate.py --dataset /secure/path/dataset --target-fmr 0.001 --json report.json
```

The script runs the production detector, quality gate and embedding with your current quality
settings (`--min-face-size`, `--min-quality`, `--min-detection-score`). It prints:

* how many images were rejected for quality or had no face,
* genuine (same person) and impostor (different people) similarity percentiles,
* a table of **FMR** (impostor pairs at or above the threshold, i.e. false matches) and
  **FNMR** (genuine pairs below it, i.e. missed matches) per threshold,
* suggested thresholds:
  * `knownThreshold`: the lowest value whose FMR ≤ `--target-fmr`,
  * `unknownThreshold`: the highest value that labels at most `--target-unknown-fnmr`
    (default 1 %) of genuine comparisons as unrecognized.

No suggestion for `knownThreshold` is printed when there are too few impostor comparisons to
support the requested FMR (fewer than 3 / FMR, the "rule of three"). Embeddings are kept in
memory only; the report contains scores, not biometric data.

### 3.3 Choose and apply

1. Pick the operating point from the table, not blindly from the suggestion. For security
   alerting, a low FMR for `KNOWN` usually matters most, because a false match hides an
   unregistered person behind a registered name.
2. Keep a gap between `unknownThreshold` and `knownThreshold`. Faces in the gap become
   `UNCERTAIN` and go to human review instead of being guessed.
3. Set `matchMargin` above the typical difference between your closest look-alike pairs
   (often 0.03–0.08).
4. Apply the values in **Settings → Recognition**. The change is audited and pushed to the AI
   service and running camera workers immediately.
5. **Validate live**: run Live Monitoring with consenting volunteers (registered and not
   registered) for at least a day and review every event in Detection History. Note false
   matches, missed matches and the share of Uncertain events, then adjust.

### 3.4 Monitor in production

* Review the share of Uncertain and Low-quality results per camera every week. A camera with
  many low-quality results usually needs repositioning or lighting changes, not lower thresholds.
* Resolutions recorded by operators (Authorized visitor, Employee not yet enrolled, False
  detection, and so on) are the best ongoing signal of real-world error rates; the Detection
  History CSV export includes the resolution of every event for this analysis.
* Re-calibrate after camera changes, seasonal lighting changes, or any model update. The model
  version is stored with every template and event.

## 4. Known limitations

* Accuracy drops with distance, motion blur, strong backlight, low resolution, extreme pose and
  occlusion. The quality gate rejects the worst cases but cannot fix poor camera placement.
* Face recognition error rates can differ between demographic groups. Measure FNMR and FMR per
  group in your validation set where it is lawful and appropriate, and do not deploy if the
  differences are unacceptable for your use case.
* Twins and close relatives may exceed any practical threshold; the margin rule routes
  ambiguous cases to Uncertain but cannot always tell them apart.
* Printed photos or screens can be presented to a camera. VITA EYE does not perform liveness
  (presentation-attack) detection, which is one more reason results must not drive physical
  access decisions on their own.
