function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`LLM_TIMEOUT_ABORTED after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function sendChatRequest(config, messages, temperature) {
  const body = {
    model: config.model,
    messages,
    max_tokens: config.maxTokens,
  };
  if (Number.isFinite(temperature)) {
    body.temperature = temperature;
  }
  if (config.responseFormat !== "off") {
    body.response_format = { type: "json_object" };
  }

  return fetchWithTimeout(
    `${config.baseUrl}${config.endpoint}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    },
    config.timeoutMs,
  );
}

function isTimeoutError(message) {
  return /LLM_TIMEOUT_ABORTED|This operation was aborted|AbortError/i.test(message);
}

function isHttpError(message) {
  return /^LLM_HTTP_\d+:/i.test(message);
}

function shouldSwitchToFallback(error) {
  const message = String(error?.message ?? error);
  return isTimeoutError(message)
    || isHttpError(message)
    || /LLM_REQUEST_EXHAUSTED/i.test(message)
    || /fetch failed|network|ECONN|ENOTFOUND/i.test(message);
}

async function requestWithSingleConfig(config, messages) {
  const attemptTemperatures = [
    Number.isFinite(config.temperature) ? config.temperature : undefined,
    1,
    undefined,
  ];
  const maxAttempts = Math.max(1, Number(config.retryCount ?? 2));
  const baseBackoffMs = Math.max(0, Number(config.retryBackoffMs ?? 600));

  if (config.debug) {
    const initial = Number.isFinite(attemptTemperatures[0]) ? String(attemptTemperatures[0]) : "unset";
    console.log(`[llm] request start model=${config.model} temp=${initial} timeout=${config.timeoutMs}ms`);
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      let response = await sendChatRequest(config, messages, attemptTemperatures[0]);
      let errorBody = response.ok ? "" : await response.text();

      if (!response.ok && response.status === 400 && /invalid temperature/i.test(errorBody)) {
        if (config.debug) {
          console.log("[llm] invalid temperature detected, retrying with compatible settings");
        }
        for (const temperature of attemptTemperatures.slice(1)) {
          response = await sendChatRequest(config, messages, temperature);
          errorBody = response.ok ? "" : await response.text();
          if (response.ok || !/invalid temperature/i.test(errorBody)) {
            break;
          }
        }
      }

      if (!response.ok) {
        const shortBody = errorBody.slice(0, 180);
        const retriable = response.status === 429 || response.status >= 500;
        if (retriable && attempt < maxAttempts) {
          const sleepMs = baseBackoffMs * 2 ** (attempt - 1);
          if (config.debug) {
            console.log(`[llm] transient error ${response.status}, retry ${attempt + 1}/${maxAttempts} in ${sleepMs}ms`);
          }
          await delay(sleepMs);
          continue;
        }
        throw new Error(`LLM_HTTP_${response.status}: ${shortBody}`);
      }

      const data = await response.json();
      const choice = data?.choices?.[0];
      if (choice?.finish_reason === "length") {
        throw new Error("LLM_OUTPUT_TRUNCATED");
      }
      const content = choice?.message?.content;
      if (typeof content === "string") {
        return content;
      }
      if (Array.isArray(content)) {
        return content.map((item) => item?.text ?? "").join("\n");
      }
      throw new Error("LLM_EMPTY_CONTENT");
    } catch (error) {
      const message = String(error?.message ?? error);
      const timeoutAbort = isTimeoutError(message);
      if (timeoutAbort && attempt < maxAttempts) {
        const sleepMs = baseBackoffMs * 2 ** (attempt - 1);
        if (config.debug) {
          console.log(`[llm] timeout/abort, retry ${attempt + 1}/${maxAttempts} in ${sleepMs}ms`);
        }
        await delay(sleepMs);
        continue;
      }
      throw error;
    }
  }

  throw new Error("LLM_REQUEST_EXHAUSTED");
}

export async function requestJsonFromLLM(config, messages) {
  try {
    return await requestWithSingleConfig(config, messages);
  } catch (error) {
    if (!config.fallback || !shouldSwitchToFallback(error)) {
      throw error;
    }

    const fallbackConfig = {
      ...config,
      model: config.fallback.model,
      apiKey: config.fallback.apiKey,
      baseUrl: config.fallback.baseUrl,
      endpoint: config.fallback.endpoint,
      temperature: Number.isFinite(config.fallback.temperature)
        ? config.fallback.temperature
        : config.temperature,
    };
    if (config.debug) {
      console.log(`[llm] primary failed (${String(error?.message ?? error).slice(0, 120)}), switching to fallback model=${fallbackConfig.model}`);
    }
    return requestWithSingleConfig(fallbackConfig, messages);
  }
}
