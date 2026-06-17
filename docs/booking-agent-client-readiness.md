# Booking Agent Client Readiness

## Summary

The client wants a deep-eval style booking-agent test pack, not a generic voice demo. Their core concern is that the agent must handle multi-step booking logic, call tools in the right order, follow the brand-approved language, and fail safely when it cannot answer.

We have added the first Lightcurve Booking Agent Eval Pack. It does not replace the existing Lightcurve platform. It sits on top of the existing scenario, experiment, sandbox-tool, scoring, and reporting system as a vertical-specific eval layer.

SuperBrynn is competitor context only. Nothing in Lightcurve depends on or integrates with SuperBrynn.

## What The Client Wants

The client is asking for these capabilities:

1. **Strict booking flow evaluation**
   - The agent must ask the right booking questions before quoting.
   - Room configuration and occupancy logic must be correct.
   - Pricing must not be given before required information is collected.

2. **Multiple tool-call correctness**
   - Availability lookup.
   - Inventory / room validation.
   - Pricing quote.
   - Package or experience lookup.
   - Escalation or transfer when the case is blocked.

3. **Brand-language adherence**
   - The agent must say what the brand wants it to say.
   - It should not improvise unsupported room names, packages, policies, or promises.
   - It should not sound generic when the brand requires exact wording.

4. **Hard failure detection**
   - Backend/internal leakage.
   - Hallucinated rooms, packages, or services.
   - Wrong price or wrong room count.
   - Skipped confirmation.
   - Tool calls in the wrong order.

5. **Deep-eval style reporting**
   - Critical failures.
   - Regression repeats.
   - Pricing contract failures.
   - Occupancy logic failures.
   - FAQ / knowledge-base grounding failures.
   - Latency, call-drop, and pronunciation issues.

## What We Added

### Booking Eval Pack

Added a dedicated booking eval engine in:

- `src/lib/bookingEval.ts`

It includes:

- 56 deterministic booking/hospitality scenarios.
- Occupancy rules for 2-3, 4, 5-6, 7-8, and 9-10 guests.
- Pricing-contract checks.
- Hallucination checks for invalid room/package names.
- Backend/internal leakage detection.
- Brand-language checks.
- Tool-sequence checks.

### Scenario Library Integration

Booking scenarios are now part of the real scenario library through:

- `src/lib/realScenarioLibrary.ts`

This lets the booking pack appear in the same scenario/experiment system as every other Lightcurve scenario.

### Reservation Sandbox Tools

Added a reservation sandbox alongside CRM and Calendar in:

- `src/lib/sandboxReplicas.ts`
- `src/app/api/sandbox/[tool]/[action]/route.ts`

The reservation sandbox supports:

- Availability lookup.
- Inventory checks.
- Quote/pricing behavior.
- Package lookup.
- Escalation path.

These are isolated run copies, so tests do not mutate reusable source data.

### Experiment Creation

Added a hospitality/booking use case in:

- `src/app/experiments/new/page.tsx`

This allows a user to start from a booking-agent business problem rather than manually assembling technical scenarios.

### Agent Replica Rules

Agent Replica now accepts booking-specific configuration:

- Brand language.
- Required phrases.
- Forbidden phrases.
- Booking-specific tool/logic constraints.

This allows low-cost prompt and policy regression testing before spending money on real phone/provider checks.

### Reporting

Booking-specific eval results now appear in:

- Experiment detail.
- Run detail.

The report shows booking rule pass/fail status, blockers, and top failed rule rationales.

## Does This Conflict With Existing Lightcurve?

No, not architecturally.

The booking work is an eval pack layered on top of Lightcurve's existing primitives:

- Scenarios.
- Experiments.
- Runs.
- Scores.
- Sandbox tools.
- Agent Replica.
- Lightcurve Room / provider-backed paths.

It does not replace the general voice-agent testing workflow.

## Potential Conflicts To Watch

### 1. Scenario Library Bias

Booking scenarios are currently added into the main scenario library. This is useful for the booking client, but if the default scenario page shows booking cases first, non-booking users may feel the product is too hospitality-specific.

Recommended guardrail:

- Keep booking scenarios visible under the hospitality/booking use case.
- Avoid making booking the default first-view for every new user.

### 2. Metric Noise

Booking metrics use the `booking_*` prefix, so they should not pollute generic runs. They only apply when a scenario is detected as booking/hospitality.

This is safe as long as we keep metric names namespaced.

### 3. Brand-Language Strictness

Brand-language eval is powerful but client-specific. If no brand language is supplied, the check falls back to generic forbidden language detection.

Recommended guardrail:

- Treat strict brand-language scoring as enabled only when the customer provides approved phrases, forbidden phrases, or a script policy.

### 4. Tool-Call Requirements

Booking scenarios expect reservation-tool events. If a run does not exercise tools, the booking eval can fail the tool-sequence check.

This is correct for booking clients, but should not apply to non-booking scenarios.

### 5. Product Positioning

This should be positioned as:

> Lightcurve can host a client-specific booking eval pack and regression gate.

Not as:

> Lightcurve has every possible booking rule already configured for every hotel.

The client still needs to provide their exact room types, pricing rules, packages, brand language, and booking policies.

## What We Can Say To The Client

We can say:

> Lightcurve is ready to configure a dedicated booking-agent eval pack for your failures. We can reproduce occupancy, pricing, tool-call, brand-language, FAQ grounding, and escalation issues before production. The platform now has the structure to turn your failure report into executable regression tests.

We should not say yet:

> The full client-specific booking evaluator is complete without your property rules and brand language.

## What We Still Need From The Client

To make the booking pack production-grade for this client, we need:

- Valid room categories.
- Invalid room names or packages to catch hallucinations.
- Occupancy rules.
- Extra bedding rules.
- Pricing formula or quote API examples.
- Tax and inclusion rules.
- Approved brand language.
- Forbidden phrases.
- FAQ / knowledge-base answers.
- Escalation rules.
- Historical failed transcripts or recordings, if available.

## Client Pilot Readiness

Current readiness:

- Platform foundation: ready.
- Booking eval pack structure: added.
- Reservation sandbox: added.
- Brand-language checks: added.
- Tool-sequence checks: added.
- Client-specific booking configuration: still needed.

Recommended pilot:

1. Convert the client PDF into 40-60 critical smoke scenarios.
2. Add 150-300 regression variants around occupancy, pricing, FAQs, and escalation.
3. Run Agent Replica first for low-cost prompt/policy regression.
4. Promote only failed or risky cases to Lightcurve Room / phone realism.
5. Deliver a report with expected behavior, actual behavior, failed rule, and recommended fix.

## Final Assessment

This does not conflict with existing Lightcurve. It strengthens the platform by proving that Lightcurve can support vertical-specific eval packs.

The only product risk is making the general app feel too booking-specific. The fix is simple: keep booking content attached to the hospitality/booking use case and keep generic scenario discovery broad.

