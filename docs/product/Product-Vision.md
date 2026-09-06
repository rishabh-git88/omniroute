# Product Vision

#product

## Promise

OmniRoute is a conversation operating layer, not three chat windows or an API aggregator. A user asks once, compares leading models for an important prompt, explicitly selects the best response, continues cheaply in Single AI mode, and can later switch models with relevant context intact.

It owns four kinds of continuity:

- conversation: active branch, selected responses, summaries, pinned instructions;
- artifacts: files, code, images, citations, and reusable outputs;
- economic: reservations, usage, charges, releases, and refunds;
- experience: composer, history, streaming, errors, and provider identity.

## Users and jobs

The initial wedge is developers and technical students. Broader users include writers, researchers, and small teams. The strongest differentiation is provider-independent projects, branches, files, evaluation evidence, and audit history—not access to many models by itself.

## Product principles

- One calm workspace; hide provider mechanics until useful.
- Compare without overload: tabs or a carousel by default, optional desktop split view.
- Make response selection and the active branch explicit.
- Show provider, model, capability, availability, context readiness, and cost honestly.
- Treat one provider's failure as partial failure.
- Never promise perfect context transfer; promise relevant saved context.

## Risks

Comparison multiplies cost, the slowest provider can shape perceived latency, context translation is imperfect, provider APIs change, and every extra provider widens the privacy boundary. See [[Credits-Billing]], [[Context-Memory]], [[Provider-Layer]], and [[Security]].

## Success signals

Measure useful prompts sent, explicit response selection, coherent continuation after switching, successful reconnection, understandable credit changes, and repeat use. Selection is preference evidence—not automatically a universal quality label; see [[Evaluation-Engine]].

## Related notes

[[User-Flows]] · [[MVP-Scope]] · [[System-Architecture]] · [[Roadmap]]

## Open Questions

- What pricing and free-credit policy supports Compare 3 without encouraging unsustainable usage?
- Which developer and technical-student workflows define the closed-beta evaluation set?
