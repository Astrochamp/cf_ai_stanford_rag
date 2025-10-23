<script lang="ts">
  import { onMount } from "svelte";
  import type {} from "./turnstile.d.ts";

  let {
    widgetId = $bindable(null),
    turnstile = $bindable(null),
    siteKey,
    appearance = "always",
    language = "auto",
    execution = "render",
    action = undefined,
    cData = undefined,
    retryInterval = 8000,
    retry = "auto",
    refreshExpired = "auto",
    theme = "auto",
    size = "normal",
    tabIndex = 0,
    forms = undefined,
    responseField = undefined,
    formsField = undefined,
    responseFieldName = undefined,
    class: _class = undefined,
    oncallback,
    onerror,
    ontimeout,
    onexpired,
    onbeforeinteractive,
    onafterinteractive,
    onunsupported,
  } = $props();

  let loaded = $state(typeof window != "undefined" && "turnstile" in window);
  let mounted = $state(false);

  $effect(() => {
    turnstile = (loaded && window.turnstile) || null;
  });

  export const reset = () => {
    widgetId && window?.turnstile?.reset(widgetId);
  };

  let renderParams = $derived({
    sitekey: siteKey,
    callback: (token: string, preClearanceObtained: boolean) => {
      oncallback?.({ token, preClearanceObtained });
    },
    "error-callback": (code: string | number) => {
      onerror?.({ code });
    },
    "timeout-callback": () => {
      ontimeout?.({});
    },
    "expired-callback": () => {
      onexpired?.({});
    },
    "before-interactive-callback": () => {
      onbeforeinteractive?.({});
    },
    "after-interactive-callback": () => {
      onafterinteractive?.({});
    },
    "unsupported-callback": () => onunsupported?.({}),
    "response-field-name":
      responseFieldName ?? formsField ?? "cf-turnstile-response",
    "response-field": responseField ?? forms ?? true,
    "refresh-expired": refreshExpired,
    "retry-interval": retryInterval,
    tabindex: tabIndex,
    appearance,
    execution,
    language,
    action,
    retry,
    theme,
    cData,
    size,
  });

  const turnstileAction = (node: HTMLElement, renderParams2: any) => {
    let id = window.turnstile!.render(node, renderParams2);
    widgetId = id;
    return {
      destroy() {
        window.turnstile!.remove(id);
      },
      update(newRenderParams: any) {
        window.turnstile!.remove(id);
        id = window.turnstile!.render(node, newRenderParams);
        widgetId = id;
      },
    };
  };

  onMount(() => {
    mounted = true;
    if (!loaded) {
      const script = document.createElement("script");
      script.type = "text/javascript";
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.addEventListener("load", () => (loaded = true), {
        once: true,
      });
      document.head.appendChild(script);
    }
    return () => {
      mounted = false;
    };
  });
</script>

{#if loaded && mounted}
  <div
    use:turnstileAction={renderParams}
    class:flexible={size == "flexible"}
    class={_class}
  ></div>
{/if}

<style>
  :where(.flexible) {
    width: 100%;
  }
</style>
