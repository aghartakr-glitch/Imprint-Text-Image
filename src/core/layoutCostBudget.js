// Back down to the original 0.03: callLayoutLLM.js no longer retries on validation failure (a
// retry costs a full second API call and often fails again anyway, wasting money on top of the
// free fallback that gets used regardless), so there's only ever one real attempt per generation
// and no need for retry headroom. clampMaxSpendUsd() below still hard-caps any caller-supplied
// value at this ceiling, and createLayoutCostBudget()/recordUsage() throw before/if spend would
// exceed it -- 0.03 is a real, enforced maximum, not just a default.
export const MAX_LAYOUT_LLM_SPEND_USD = 0.03

const PRICING_USD_PER_MTOK = {
  input: 3,
  output: 15,
}

const TOKEN_COUNT_OVERHEAD = 64
const COST_EPSILON_USD = 0.000001

export class LayoutCostBudgetExceeded extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'LayoutCostBudgetExceeded'
    this.details = details
  }
}

function clampMaxSpendUsd(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return MAX_LAYOUT_LLM_SPEND_USD
  return Math.min(parsed, MAX_LAYOUT_LLM_SPEND_USD)
}

export function estimateTokenCostUsd({ inputTokens = 0, outputTokens = 0 }) {
  return ((inputTokens * PRICING_USD_PER_MTOK.input) + (outputTokens * PRICING_USD_PER_MTOK.output)) / 1_000_000
}

function estimateTokensConservatively(content) {
  const text = typeof content === 'string' ? content : JSON.stringify(content ?? '')
  return Math.max(1, text.length + TOKEN_COUNT_OVERHEAD)
}

async function countInputTokens(client, { model, system, userPromptContent }) {
  const params = {
    model,
    system,
    messages: [{ role: 'user', content: userPromptContent }],
  }

  try {
    const result = typeof client?.messages?.countTokens === 'function'
      ? await client.messages.countTokens(params)
      : await client?.beta?.messages?.countTokens?.(params)
    const inputTokens = Number(result?.input_tokens)
    if (Number.isFinite(inputTokens) && inputTokens > 0) {
      return { inputTokens, source: 'anthropic-count-tokens' }
    }
  } catch {
    // Fall back to a deliberately high estimate; spending less is better than surprise spend.
  }

  return {
    inputTokens: estimateTokensConservatively(system) + estimateTokensConservatively(userPromptContent),
    source: 'conservative-estimate',
  }
}

export function createLayoutCostBudget(options = {}) {
  const maxSpendUsd = clampMaxSpendUsd(options.maxSpendUsd ?? process.env.LAYOUT_LLM_MAX_SPEND_USD)
  let spentUsd = 0
  const calls = []

  return {
    maxSpendUsd,
    calls,
    get spentUsd() {
      return Number(spentUsd.toFixed(6))
    },
    get remainingUsd() {
      return Math.max(0, Number((maxSpendUsd - spentUsd).toFixed(6)))
    },
    async planRequest({
      client, model, system, userPromptContent, desiredOutputTokens, minOutputTokens,
    }) {
      const { inputTokens, source } = await countInputTokens(client, { model, system, userPromptContent })
      const inputCostUsd = estimateTokenCostUsd({ inputTokens })
      const remainingAfterInputUsd = maxSpendUsd - spentUsd - inputCostUsd
      const affordableOutputTokens = Math.floor((remainingAfterInputUsd * 1_000_000) / PRICING_USD_PER_MTOK.output)
      const maxOutputTokens = Math.min(desiredOutputTokens, affordableOutputTokens)

      if (maxOutputTokens < minOutputTokens) {
        throw new LayoutCostBudgetExceeded(
          `LLM 비용 예산 $${maxSpendUsd.toFixed(2)} 초과 방지를 위해 API 호출을 중단했습니다.`,
          {
            maxSpendUsd,
            spentUsd,
            remainingUsd: maxSpendUsd - spentUsd,
            estimatedInputTokens: inputTokens,
            inputTokenSource: source,
            minOutputTokens,
            affordableOutputTokens: Math.max(0, affordableOutputTokens),
          },
        )
      }

      const plannedCostUsd = estimateTokenCostUsd({ inputTokens, outputTokens: maxOutputTokens })
      const planned = {
        inputTokenSource: source,
        estimatedInputTokens: inputTokens,
        maxOutputTokens,
        plannedCostUsd,
      }
      calls.push(planned)
      return planned
    },
    recordUsage(planned, usage = {}) {
      const inputTokens = Number(usage.input_tokens)
      const outputTokens = Number(usage.output_tokens)
      const hasActualUsage = Number.isFinite(inputTokens) && Number.isFinite(outputTokens)
      const chargedCostUsd = hasActualUsage
        ? estimateTokenCostUsd({ inputTokens, outputTokens })
        : planned.plannedCostUsd

      spentUsd += chargedCostUsd
      Object.assign(planned, {
        actualInputTokens: hasActualUsage ? inputTokens : null,
        actualOutputTokens: hasActualUsage ? outputTokens : null,
        chargedCostUsd,
      })

      if (spentUsd > maxSpendUsd + COST_EPSILON_USD) {
        throw new LayoutCostBudgetExceeded(
          `LLM 비용이 설정된 $${maxSpendUsd.toFixed(2)} 예산을 초과했습니다.`,
          { maxSpendUsd, spentUsd },
        )
      }
    },
    summary() {
      return {
        max_spend_usd: maxSpendUsd,
        spent_usd: Number(spentUsd.toFixed(6)),
        remaining_usd: Math.max(0, Number((maxSpendUsd - spentUsd).toFixed(6))),
        calls: calls.map((call) => ({ ...call })),
      }
    },
  }
}
