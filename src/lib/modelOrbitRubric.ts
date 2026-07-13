export type ModelOrbitSubject = 'human' | 'agent' | 'interaction';
export type ModelOrbitCategory = 'behavior' | 'temporal' | 'interaction';
export type ModelOrbitUnit = 'intensity_0_4' | 'milliseconds' | 'words_per_minute' | 'ratio_0_1';

export type ModelOrbitAttribute = {
  id: string;
  label: string;
  category: ModelOrbitCategory;
  subjects: readonly ModelOrbitSubject[];
  unit: ModelOrbitUnit;
  definition: string;
  evidence: string;
  anchors?: { low: string; middle: string; high: string };
};

const paired = (id: string, label: string, definition: string, low: string, middle: string, high: string): ModelOrbitAttribute => ({
  id,
  label,
  category: 'behavior',
  subjects: ['human', 'agent'],
  unit: 'intensity_0_4',
  definition,
  evidence: 'Transcript language, discourse form, and eventually calibrated acoustic evidence.',
  anchors: { low, middle, high },
});

export const MODEL_ORBIT_ATTRIBUTES: readonly ModelOrbitAttribute[] = [
  paired('politeness', 'Politeness', 'Observable respectful and considerate language.', 'Hostile or contemptuous', 'Neutral and transactional', 'Highly considerate and tactful'),
  paired('anger', 'Anger', 'Expressed anger, hostility, or aggressive intensity.', 'No anger observed', 'Noticeable anger', 'Sustained intense anger'),
  paired('frustration', 'Frustration', 'Signals of blocked progress, annoyance, or dissatisfaction.', 'No frustration observed', 'Repeated annoyance', 'Severe sustained frustration'),
  paired('confusion', 'Confusion', 'Uncertainty about facts, instructions, state, or what happens next.', 'No confusion observed', 'Clarification is needed', 'Unable to follow the interaction'),
  paired('urgency', 'Urgency', 'Pressure for immediate action or a time-sensitive response.', 'No urgency', 'Time pressure is present', 'Immediate action is demanded'),
  paired('assertiveness', 'Assertiveness', 'Directness and firmness when stating needs or decisions.', 'Very tentative', 'Direct but flexible', 'Highly firm or commanding'),
  paired('empathy', 'Empathy', "Recognition of the other party's feelings or circumstances.", 'No acknowledgement', 'Basic acknowledgement', 'Strong specific emotional recognition'),
  paired('confidence', 'Confidence', 'Certainty expressed in statements and decisions.', 'Highly uncertain', 'Moderately certain', 'Very certain and decisive'),
  paired('cooperation', 'Cooperation', 'Willingness to provide information and move the interaction forward.', 'Actively obstructive', 'Partially cooperative', 'Consistently collaborative'),
  paired('clarity', 'Clarity', 'Degree to which meaning is explicit and structurally understandable.', 'Meaning is difficult to recover', 'Mostly understandable', 'Explicit and unambiguous'),
  paired('hesitation', 'Hesitation', 'Pauses, fillers, hedges, or self-delays before committing.', 'No hesitation', 'Occasional hesitation', 'Persistent hesitation'),
  paired('defensiveness', 'Defensiveness', "Language that rejects responsibility or protects one's position.", 'No defensiveness', 'Some justification or resistance', 'Strong repeated self-protection'),
  paired('curiosity', 'Curiosity', 'Active requests for additional information or explanation.', 'No inquiry', 'Some information seeking', 'Sustained exploratory questioning'),
  paired('respect', 'Respect', "Recognition of the other party's status, boundaries, and right to respond.", 'Dismissive or degrading', 'Basic respect', 'Consistently affirming boundaries'),
  paired('flexibility', 'Flexibility', 'Willingness to consider alternatives or adjust a position.', 'Rejects alternatives', 'Considers some alternatives', 'Actively adapts and offers options'),
  paired('persuasiveness', 'Persuasiveness', "Use of reasons, framing, or appeals intended to change the other party's position.", 'No persuasive attempt', 'Some reasons or framing', 'Sustained structured persuasion'),

  { id: 'response_latency_ms', label: 'Response latency', category: 'temporal', subjects: ['interaction'], unit: 'milliseconds', definition: 'Time from one speaker finishing to the other beginning.', evidence: 'Turn timestamps or SDK-measured latency.' },
  { id: 'pause_duration_ms', label: 'Pause duration', category: 'temporal', subjects: ['interaction'], unit: 'milliseconds', definition: 'Observed silence between adjacent turns.', evidence: 'Speech start and stop timestamps.' },
  { id: 'turn_duration_ms', label: 'Turn duration', category: 'temporal', subjects: ['interaction'], unit: 'milliseconds', definition: 'Duration of each speaking turn.', evidence: 'Speech start and stop timestamps; estimated only when timestamps are missing.' },
  { id: 'words_per_minute', label: 'Speaking rate', category: 'temporal', subjects: ['interaction'], unit: 'words_per_minute', definition: 'Words spoken per minute for measured turns.', evidence: 'Transcript word count divided by measured speech duration.' },
  { id: 'interruption_rate', label: 'Interruption rate', category: 'temporal', subjects: ['interaction'], unit: 'ratio_0_1', definition: 'Share of turn transitions that begin before the previous turn ends.', evidence: 'Overlapping speaker timestamps.' },
  { id: 'overlap_rate', label: 'Overlap rate', category: 'temporal', subjects: ['interaction'], unit: 'ratio_0_1', definition: 'Share of total speaking time containing both speakers.', evidence: 'Overlapping speaker intervals.' },
  { id: 'silence_ratio', label: 'Silence ratio', category: 'temporal', subjects: ['interaction'], unit: 'ratio_0_1', definition: 'Share of call time containing no speech.', evidence: 'Call duration and speech intervals.' },
  { id: 'talk_ratio', label: 'Human talk ratio', category: 'temporal', subjects: ['interaction'], unit: 'ratio_0_1', definition: 'Human speaking time divided by total speaking time.', evidence: 'Speaker-separated turn durations.' },
  { id: 'repair_latency_ms', label: 'Repair latency', category: 'temporal', subjects: ['interaction'], unit: 'milliseconds', definition: 'Time between a confusion signal and the next repair attempt.', evidence: 'Confusion observations and turn timestamps.' },
  { id: 'escalation_time_ms', label: 'Escalation timing', category: 'temporal', subjects: ['interaction'], unit: 'milliseconds', definition: 'Time from call start to the highest observed anger or frustration point.', evidence: 'Temporal graph and behavioral observations.' },

  { id: 'sentiment_alignment', label: 'Sentiment alignment', category: 'interaction', subjects: ['interaction'], unit: 'intensity_0_4', definition: 'Similarity in emotional direction between adjacent human and agent turns.', evidence: 'Paired affect observations.', anchors: { low: 'Strongly divergent', middle: 'Partially aligned', high: 'Closely aligned' } },
  { id: 'deescalation', label: 'De-escalation', category: 'interaction', subjects: ['interaction'], unit: 'intensity_0_4', definition: 'Observed reduction in anger or frustration after the other party responds.', evidence: 'Change in affect across linked temporal nodes.', anchors: { low: 'Escalation continues', middle: 'Emotion remains stable', high: 'Strong sustained reduction' } },
  { id: 'confusion_recovery', label: 'Confusion recovery', category: 'interaction', subjects: ['interaction'], unit: 'intensity_0_4', definition: 'Reduction of confusion after a clarification or repair turn.', evidence: 'Confusion trend across linked nodes.', anchors: { low: 'Confusion increases', middle: 'Partial recovery', high: 'Confusion clearly resolves' } },
  { id: 'question_answer_fit', label: 'Question-answer fit', category: 'interaction', subjects: ['interaction'], unit: 'ratio_0_1', definition: 'Share of questions followed by an on-topic response.', evidence: 'Question and response node pairs.' },
  { id: 'repetition_rate', label: 'Repetition rate', category: 'interaction', subjects: ['interaction'], unit: 'ratio_0_1', definition: 'Share of turns substantially repeating an earlier same-speaker turn.', evidence: 'Token overlap across same-speaker nodes.' },
  { id: 'topic_drift', label: 'Topic drift', category: 'interaction', subjects: ['interaction'], unit: 'intensity_0_4', definition: 'Movement away from the active goal or topic.', evidence: 'Temporal graph state changes.', anchors: { low: 'No drift', middle: 'Temporary side path', high: 'Goal is substantially displaced' } },
  { id: 'conversational_progress', label: 'Conversational progress', category: 'interaction', subjects: ['interaction'], unit: 'ratio_0_1', definition: 'Share of graph transitions that advance the active goal.', evidence: 'Rasa state transitions and temporal graph edges.' },
  { id: 'resolution_efficiency', label: 'Resolution efficiency', category: 'interaction', subjects: ['interaction'], unit: 'ratio_0_1', definition: 'Progress-producing turns divided by all turns before resolution.', evidence: 'Goal-state transitions and terminal outcome.' },
  { id: 'information_exchange', label: 'Information exchange', category: 'interaction', subjects: ['interaction'], unit: 'ratio_0_1', definition: 'Share of turns that introduce a new relevant fact, answer, slot, or decision.', evidence: 'Entities, slots, facts, and temporal graph state.' },
  { id: 'dominance_balance', label: 'Dominance balance', category: 'interaction', subjects: ['interaction'], unit: 'ratio_0_1', definition: 'Balance between human and agent speaking time, where 1 is equal time.', evidence: 'Speaker-separated turn durations.' },
] as const;

export const MODEL_ORBIT_RUBRIC = {
  id: 'modelorbit-conversation-profile',
  version: '1.0.0-draft',
  attributeCount: MODEL_ORBIT_ATTRIBUTES.length,
  principle: 'Measure observable quantity and intensity; do not treat high values as inherently good or bad.',
};

export const PARTICIPANT_ATTRIBUTES = MODEL_ORBIT_ATTRIBUTES.filter((attribute) => attribute.category === 'behavior');
export const TEMPORAL_ATTRIBUTES = MODEL_ORBIT_ATTRIBUTES.filter((attribute) => attribute.category === 'temporal');
export const INTERACTION_ATTRIBUTES = MODEL_ORBIT_ATTRIBUTES.filter((attribute) => attribute.category === 'interaction');
