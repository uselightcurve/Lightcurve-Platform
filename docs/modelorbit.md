# ModelOrbit v1

ModelOrbit is Lightcurve's observational evaluation layer. It runs beside the automated replay, pass/fail, and fix workflow. It measures how the human and agent spoke without treating a high behavioral intensity as inherently good or bad.

## Output

Each call produces:

- a temporal graph with source nodes;
- separate human and agent profiles;
- 16 shared behavioral attributes per speaker;
- 10 temporal measurements;
- 10 interaction measurements;
- evidence, evaluator identity, confidence, and disagreement for every observation.

The draft rubric contains 36 attributes and is versioned as `1.0.0-draft`. The UI must continue showing the rubric version because scores from different rubric versions are not automatically comparable.

## Reliability contract

ModelOrbit must never convert missing evidence into a confident zero. Every observation stores the source nodes, evaluator versions, evidence, confidence, and evaluator disagreement. The system abstains when evidence is unavailable.

The first implementation includes deterministic temporal measurement plus two transparent transcript feature evaluators. Transcript-derived behavioral measurements are provisional and capped at moderate confidence. They are not a substitute for calibrated human labels or acoustic evidence.

## Human evaluator calibration

1. Select 300 to 500 calls covering domains, outcomes, accents, call lengths, and emotional conditions.
2. Train evaluators with the same operational definitions, anchors, positive examples, counterexamples, and exclusions.
3. Assign every calibration call to at least two independent evaluators.
4. Send disagreements to a third evaluator without revealing the earlier labels.
5. Measure agreement separately for every attribute.
6. Rewrite or remove attributes that evaluators cannot apply consistently.
7. Freeze the approved rubric before training production classifiers.
8. Keep low-agreement attributes in human review rather than forcing an automated score.

## Planned evaluator layers

1. Temporal: timestamps, pauses, overlap, interruptions, speaking time, and response latency.
2. Acoustic: pitch, energy, speaking rate, voice stability, and calibrated affect features.
3. Behavioral: attribute-specific models trained from approved human labels.
4. Human: calibration, adjudication, low-confidence review, and drift audits.

Rasa tracker events should enrich graph state with intents, entities, slots, actions, and flow transitions. Rasa state is evidence for the evaluator; Rasa is not the scoring authority.

An LLM may summarize already verified measurements for a developer. It must not create ModelOrbit ground-truth scores.

