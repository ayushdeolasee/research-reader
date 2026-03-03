import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";
import {
  Bot,
  MessageSquare,
  Mic,
  Send,
  Settings,
  Square,
  Trash2,
} from "lucide-react";
import { MarkdownMessage } from "@/components/ai/MarkdownMessage";
import { useAiStore } from "@/stores/ai-store";
import { buildLiveSessionPrompt } from "@/lib/ai-prompts";
import { cn } from "@/lib/utils";
import { usePdfStore } from "@/stores/pdf-store";
import { useAnnotationStore } from "@/stores/annotation-store";

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

const MODELS = [
  "gemini-3.1-flash-lite",
  "gemini-3-pro-preview",
  "gemini-3-flash-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-live-2.5-flash-preview",
  "gemini-2.0-flash-live-preview-04-09",
  "gemini-2.5-flash-preview-09-2025",
  "gemini-2.5-flash-lite-preview-09-2025",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-pro",
  "gemini-1.5-flash",
];
const SNAPSHOT_MAX_DIMENSION = 1280;
const SNAPSHOT_JPEG_QUALITY = 0.72;
const CONVERSATION_SEND_DEBOUNCE_MS = 900;
const MAX_LIVE_CONTEXT_CHARS = 9_000;

function resolveLiveModel(model: string): string {
  if (model.includes("live")) return model;
  return "gemini-live-2.5-flash-preview";
}

export function AiPanel() {
  const messages = useAiStore((s) => s.messages);
  const isThinking = useAiStore((s) => s.isThinking);
  const error = useAiStore((s) => s.error);
  const settings = useAiStore((s) => s.settings);
  const pageTexts = useAiStore((s) => s.pageTexts);
  const setSettings = useAiStore((s) => s.setSettings);
  const clearConversation = useAiStore((s) => s.clearConversation);
  const sendMessage = useAiStore((s) => s.sendMessage);
  const sendConversationMessage = useAiStore((s) => s.sendConversationMessage);
  const addLocalMessage = useAiStore((s) => s.addLocalMessage);
  const updateLocalMessage = useAiStore((s) => s.updateLocalMessage);
  const setThinkingState = useAiStore((s) => s.setThinkingState);
  const setErrorState = useAiStore((s) => s.setErrorState);

  const doc = usePdfStore((s) => s.document);
  const currentPage = usePdfStore((s) => s.currentPage);
  const numPages = usePdfStore((s) => s.numPages);
  const visiblePages = usePdfStore((s) => s.visiblePages);
  const annotations = useAnnotationStore((s) => s.annotations);

  const [input, setInput] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isConversationActive, setIsConversationActive] = useState(false);
  const [conversationInterimText, setConversationInterimText] = useState("");

  const pushToTalkRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const conversationRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const liveSessionRef = useRef<Session | null>(null);
  const connectLiveSessionRef = useRef<(() => Promise<boolean>) | null>(null);
  const liveReplyMessageIdRef = useRef<string | null>(null);
  const liveReplyBufferRef = useRef("");

  const listRef = useRef<HTMLDivElement>(null);
  const lastSpokenMessageIdRef = useRef<string | null>(null);
  const pushToTalkListeningRef = useRef(false);
  const conversationListeningRef = useRef(false);
  const conversationPendingTextRef = useRef("");
  const conversationSendTimerRef = useRef<number | null>(null);
  const shouldAutoRestartConversationRef = useRef(false);
  const resumeConversationAfterReplyRef = useRef(false);
  const isThinkingRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const isConversationActiveRef = useRef(false);

  useEffect(() => {
    isThinkingRef.current = isThinking;
  }, [isThinking]);

  useEffect(() => {
    isConversationActiveRef.current = isConversationActive;
  }, [isConversationActive]);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, isThinking]);

  const latestAssistantMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i];
    }
    return null;
  }, [messages]);

  const clearConversationSendTimer = useCallback(() => {
    if (conversationSendTimerRef.current !== null) {
      window.clearTimeout(conversationSendTimerRef.current);
      conversationSendTimerRef.current = null;
    }
  }, []);

  const getSpeechRecognitionCtor = useCallback(() => {
    return (
      (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike })
        .SpeechRecognition ??
      (window as unknown as {
        webkitSpeechRecognition?: new () => SpeechRecognitionLike;
      }).webkitSpeechRecognition
    );
  }, []);

  const stopConversationListening = useCallback((disableAutoRestart = false) => {
    if (disableAutoRestart) {
      shouldAutoRestartConversationRef.current = false;
    }
    if (!conversationListeningRef.current) return;

    conversationListeningRef.current = false;
    setIsListening(false);

    try {
      conversationRecognitionRef.current?.stop();
    } catch {
      // Ignore recognition stop errors.
    }
  }, []);

  const startConversationListening = useCallback(() => {
    if (settings.voiceMode !== "conversation") return;
    if (!isConversationActiveRef.current) return;
    if (!shouldAutoRestartConversationRef.current) return;
    if (conversationListeningRef.current) return;
    if (isThinkingRef.current || isSpeakingRef.current) return;
    if (!liveSessionRef.current) return;

    const recognition = conversationRecognitionRef.current;
    if (!recognition) return;

    try {
      conversationListeningRef.current = true;
      setIsListening(true);
      recognition.start();
    } catch {
      conversationListeningRef.current = false;
      setIsListening(false);
    }
  }, [settings.voiceMode]);

  const captureCurrentPageImage = useCallback(() => {
    const pageRoot = window.document.querySelector(
      `[data-page-number="${currentPage}"]`,
    ) as HTMLElement | null;
    if (!pageRoot) return null;

    const sourceCanvas = pageRoot.querySelector("canvas");
    if (!(sourceCanvas instanceof HTMLCanvasElement)) return null;
    if (sourceCanvas.width < 2 || sourceCanvas.height < 2) return null;

    try {
      let outputCanvas: HTMLCanvasElement = sourceCanvas;
      const maxDimension = Math.max(sourceCanvas.width, sourceCanvas.height);

      if (maxDimension > SNAPSHOT_MAX_DIMENSION) {
        const scale = SNAPSHOT_MAX_DIMENSION / maxDimension;
        const targetWidth = Math.max(1, Math.round(sourceCanvas.width * scale));
        const targetHeight = Math.max(1, Math.round(sourceCanvas.height * scale));

        const resizedCanvas = window.document.createElement("canvas");
        resizedCanvas.width = targetWidth;
        resizedCanvas.height = targetHeight;
        const ctx = resizedCanvas.getContext("2d");
        if (!ctx) return null;

        ctx.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight);
        outputCanvas = resizedCanvas;
      }

      const dataUrl = outputCanvas.toDataURL("image/jpeg", SNAPSHOT_JPEG_QUALITY);
      const match = dataUrl.match(/^data:(.+);base64,(.+)$/);
      if (!match) return null;

      return {
        pageNumber: currentPage,
        mediaType: match[1],
        base64Data: match[2],
        width: outputCanvas.width,
        height: outputCanvas.height,
      };
    } catch {
      return null;
    }
  }, [currentPage]);

  const sendWithContext = useCallback(
    async (rawText: string, useConversationPath: boolean) => {
      const trimmed = rawText.trim();
      if (!trimmed || isThinkingRef.current) return;

      const context = {
        title: doc?.title ?? null,
        numPages,
        currentPage,
        visiblePages,
        annotations,
        currentPageImage: captureCurrentPageImage(),
      };

      if (useConversationPath) {
        await sendConversationMessage(trimmed, context);
      } else {
        await sendMessage(trimmed, context);
      }
    },
    [
      annotations,
      captureCurrentPageImage,
      currentPage,
      doc?.title,
      numPages,
      sendConversationMessage,
      sendMessage,
      visiblePages,
    ],
  );

  const buildLivePrompt = useCallback(
    (rawText: string) => {
      const visibleText = visiblePages
        .map((page) => `[Page ${page}] ${pageTexts[page] ?? ""}`)
        .join("\n");
      const currentAnnotations = annotations
        .filter((a) => a.page_number === currentPage)
        .slice(-30)
        .map((a) => {
          const selected = a.position_data?.selected_text ?? "";
          const note = a.content ?? "";
          return `- (${a.type}) color=${a.color ?? "none"} text="${selected}" note="${note}"`;
        })
        .join("\n");

      return buildLiveSessionPrompt({
        documentTitle: doc?.title ?? "Untitled",
        totalPages: numPages,
        currentPage,
        visiblePages: visiblePages.join(", ") || "none",
        visiblePageText: visibleText || "(none)",
        currentPageAnnotations: currentAnnotations || "(none)",
        userMessage: rawText,
      }).slice(0, MAX_LIVE_CONTEXT_CHARS);
    },
    [annotations, currentPage, doc?.title, numPages, pageTexts, visiblePages],
  );

  const connectLiveSession = useCallback(async () => {
    const apiKey = settings.apiKey.trim();
    if (!apiKey) {
      setErrorState("Set your Gemini API key in AI settings.");
      return false;
    }

    try {
      liveSessionRef.current?.close();
    } catch {
      // Ignore close errors.
    }
    liveSessionRef.current = null;
    liveReplyBufferRef.current = "";
    liveReplyMessageIdRef.current = null;

    try {
      const ai = new GoogleGenAI({ apiKey });
      const session = await ai.live.connect({
        model: resolveLiveModel(settings.model.trim() || "gemini-live-2.5-flash-preview"),
        config: {
          responseModalities: [Modality.TEXT],
          temperature: 0.2,
        },
        callbacks: {
          onmessage: (event: LiveServerMessage) => {
            const delta = event.text ?? "";
            if (delta) {
              if (!liveReplyMessageIdRef.current) {
                liveReplyBufferRef.current = "";
                liveReplyMessageIdRef.current = addLocalMessage("assistant", "");
              }
              liveReplyBufferRef.current += delta;
              updateLocalMessage(
                liveReplyMessageIdRef.current,
                liveReplyBufferRef.current,
              );
            }

            if (event.serverContent?.turnComplete) {
              if (
                liveReplyMessageIdRef.current &&
                !liveReplyBufferRef.current.trim()
              ) {
                updateLocalMessage(
                  liveReplyMessageIdRef.current,
                  "I couldn't produce a response.",
                );
              }

              liveReplyBufferRef.current = "";
              liveReplyMessageIdRef.current = null;
              setThinkingState(false);

              const shouldResumeListening =
                isConversationActiveRef.current &&
                (!settings.ttsEnabled || !("speechSynthesis" in window));
              if (shouldResumeListening) {
                resumeConversationAfterReplyRef.current = false;
                startConversationListening();
              }
            }
          },
          onerror: (e) => {
            setThinkingState(false);
            setErrorState(String(e.error ?? "Gemini Live connection error."));
          },
          onclose: () => {
            liveSessionRef.current = null;
            conversationListeningRef.current = false;
            setIsListening(false);

            if (
              shouldAutoRestartConversationRef.current &&
              isConversationActiveRef.current &&
              settings.voiceMode === "conversation"
            ) {
              window.setTimeout(() => {
                void connectLiveSessionRef.current?.().then((connected) => {
                  if (connected) {
                    startConversationListening();
                  }
                });
              }, 300);
            }
          },
        },
      });

      liveSessionRef.current = session;
      setErrorState(null);
      return true;
    } catch (err) {
      setErrorState(`Failed to connect Gemini Live: ${String(err)}`);
      return false;
    }
  }, [
    addLocalMessage,
    setErrorState,
    setThinkingState,
    settings.apiKey,
    settings.model,
    settings.ttsEnabled,
    settings.voiceMode,
    startConversationListening,
    updateLocalMessage,
  ]);

  useEffect(() => {
    connectLiveSessionRef.current = connectLiveSession;
  }, [connectLiveSession]);

  const sendLiveTurn = useCallback(
    async (rawText: string) => {
      const trimmed = rawText.trim();
      if (!trimmed) return;

      const session = liveSessionRef.current;
      if (!session) {
        await sendWithContext(trimmed, true);
        return;
      }

      addLocalMessage("user", trimmed);
      setThinkingState(true);
      setErrorState(null);

      liveReplyBufferRef.current = "";
      liveReplyMessageIdRef.current = null;

      const prompt = buildLivePrompt(trimmed);
      const pageImage = captureCurrentPageImage();
      const parts: Array<
        { text: string } | { inlineData: { mimeType: string; data: string } }
      > = [{ text: prompt }];

      if (pageImage?.base64Data) {
        parts.push({
          inlineData: {
            mimeType: pageImage.mediaType,
            data: pageImage.base64Data,
          },
        });
      }

      session.sendClientContent({
        turns: [{ role: "user", parts }],
        turnComplete: true,
      });
    },
    [
      addLocalMessage,
      buildLivePrompt,
      captureCurrentPageImage,
      sendWithContext,
      setErrorState,
      setThinkingState,
    ],
  );

  const flushConversationTurn = useCallback(async () => {
    clearConversationSendTimer();

    const text = conversationPendingTextRef.current.trim();
    if (!text || isThinkingRef.current) return;

    conversationPendingTextRef.current = "";
    setConversationInterimText("");
    setInput("");

    stopConversationListening(false);
    resumeConversationAfterReplyRef.current = true;

    await sendLiveTurn(text);

    const canSpeak = settings.ttsEnabled && "speechSynthesis" in window;
    if (!canSpeak && isConversationActiveRef.current) {
      resumeConversationAfterReplyRef.current = false;
      startConversationListening();
    }
  }, [
    clearConversationSendTimer,
    sendLiveTurn,
    settings.ttsEnabled,
    startConversationListening,
    stopConversationListening,
  ]);

  const scheduleConversationTurnSend = useCallback(() => {
    clearConversationSendTimer();
    conversationSendTimerRef.current = window.setTimeout(() => {
      void flushConversationTurn();
    }, CONVERSATION_SEND_DEBOUNCE_MS);
  }, [clearConversationSendTimer, flushConversationTurn]);

  const createPushToTalkRecognition = useCallback(() => {
    const ctor = getSpeechRecognitionCtor();
    if (!ctor) return null;

    const recognition = new ctor();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ")
        .trim();

      if (transcript) {
        setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
      }
    };

    recognition.onerror = () => {
      pushToTalkListeningRef.current = false;
      if (settings.voiceMode === "push-to-talk") {
        setIsListening(false);
      }
    };

    recognition.onend = () => {
      pushToTalkListeningRef.current = false;
      if (settings.voiceMode === "push-to-talk") {
        setIsListening(false);
      }
    };

    return recognition;
  }, [getSpeechRecognitionCtor, settings.voiceMode]);

  const createConversationRecognition = useCallback(() => {
    const ctor = getSpeechRecognitionCtor();
    if (!ctor) return null;

    const recognition = new ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      let interim = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript?.trim() ?? "";
        if (!transcript) continue;

        if (result.isFinal) {
          conversationPendingTextRef.current = [
            conversationPendingTextRef.current,
            transcript,
          ]
            .filter(Boolean)
            .join(" ")
            .trim();
        } else {
          interim = [interim, transcript].filter(Boolean).join(" ").trim();
        }
      }

      const preview = [conversationPendingTextRef.current, interim]
        .filter(Boolean)
        .join(" ")
        .trim();

      setConversationInterimText(preview);
      setInput(preview);

      if (conversationPendingTextRef.current) {
        scheduleConversationTurnSend();
      }
    };

    recognition.onerror = () => {
      conversationListeningRef.current = false;
      if (settings.voiceMode === "conversation") {
        setIsListening(false);
      }
    };

    recognition.onend = () => {
      conversationListeningRef.current = false;
      if (settings.voiceMode === "conversation") {
        setIsListening(false);
      }

      if (
        isConversationActiveRef.current &&
        shouldAutoRestartConversationRef.current &&
        settings.voiceMode === "conversation" &&
        !isThinkingRef.current &&
        !isSpeakingRef.current
      ) {
        window.setTimeout(() => {
          startConversationListening();
        }, 120);
      }
    };

    return recognition;
  }, [
    getSpeechRecognitionCtor,
    scheduleConversationTurnSend,
    settings.voiceMode,
    startConversationListening,
  ]);

  const handlePushToTalkStart = useCallback(() => {
    if (settings.voiceMode !== "push-to-talk") return;
    if (pushToTalkListeningRef.current) return;

    const recognition =
      pushToTalkRecognitionRef.current ?? createPushToTalkRecognition();
    if (!recognition) return;
    pushToTalkRecognitionRef.current = recognition;

    try {
      pushToTalkListeningRef.current = true;
      setIsListening(true);
      recognition.start();
    } catch {
      pushToTalkListeningRef.current = false;
      setIsListening(false);
    }
  }, [createPushToTalkRecognition, settings.voiceMode]);

  const handlePushToTalkStop = useCallback(() => {
    if (!pushToTalkListeningRef.current) return;

    pushToTalkListeningRef.current = false;
    if (settings.voiceMode === "push-to-talk") {
      setIsListening(false);
    }

    try {
      pushToTalkRecognitionRef.current?.stop();
    } catch {
      // Ignore recognition stop errors.
    }
  }, [settings.voiceMode]);

  const stopConversationMode = useCallback(() => {
    shouldAutoRestartConversationRef.current = false;
    resumeConversationAfterReplyRef.current = false;

    clearConversationSendTimer();
    conversationPendingTextRef.current = "";
    setConversationInterimText("");
    liveReplyBufferRef.current = "";
    liveReplyMessageIdRef.current = null;

    setIsConversationActive(false);
    stopConversationListening(true);

    try {
      liveSessionRef.current?.close();
    } catch {
      // Ignore close errors.
    }
    liveSessionRef.current = null;

    if (settings.voiceMode === "conversation") {
      setIsListening(false);
      setInput("");
    }

    setThinkingState(false);
  }, [
    clearConversationSendTimer,
    settings.voiceMode,
    setThinkingState,
    stopConversationListening,
  ]);

  const startConversationMode = useCallback(async () => {
    if (settings.voiceMode !== "conversation") return;

    const recognition =
      conversationRecognitionRef.current ?? createConversationRecognition();
    if (!recognition) {
      setErrorState("Speech recognition is not available in this environment.");
      return;
    }

    conversationRecognitionRef.current = recognition;

    const connected = await connectLiveSession();
    if (!connected) return;

    shouldAutoRestartConversationRef.current = true;
    setIsConversationActive(true);
    startConversationListening();
  }, [
    connectLiveSession,
    createConversationRecognition,
    setErrorState,
    settings.voiceMode,
    startConversationListening,
  ]);

  const toggleConversationMode = useCallback(() => {
    if (isConversationActiveRef.current) {
      stopConversationMode();
    } else {
      void startConversationMode();
    }
  }, [startConversationMode, stopConversationMode]);

  useEffect(() => {
    if (!settings.ttsEnabled) return;
    if (isThinking) return;
    if (!latestAssistantMessage) return;
    if (latestAssistantMessage.id === lastSpokenMessageIdRef.current) return;
    if (!("speechSynthesis" in window)) return;

    lastSpokenMessageIdRef.current = latestAssistantMessage.id;
    const synth = window.speechSynthesis;

    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(latestAssistantMessage.content);
    utterance.rate = 1;
    utterance.pitch = 1;

    utterance.onstart = () => {
      isSpeakingRef.current = true;
    };

    const handleSpeechDone = () => {
      isSpeakingRef.current = false;
      if (resumeConversationAfterReplyRef.current && isConversationActiveRef.current) {
        resumeConversationAfterReplyRef.current = false;
        startConversationListening();
      }
    };

    utterance.onend = handleSpeechDone;
    utterance.onerror = handleSpeechDone;

    synth.speak(utterance);
  }, [isThinking, latestAssistantMessage, settings.ttsEnabled, startConversationListening]);

  useEffect(() => {
    return () => {
      clearConversationSendTimer();
      handlePushToTalkStop();
      stopConversationMode();
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [clearConversationSendTimer, handlePushToTalkStop, stopConversationMode]);

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      const trimmed = input.trim();
      if (!trimmed || isThinkingRef.current) return;

      const conversationMode = settings.voiceMode === "conversation";
      if (conversationMode && isConversationActiveRef.current) {
        stopConversationListening(false);
        resumeConversationAfterReplyRef.current = true;
      }

      setInput("");
      setConversationInterimText("");
      conversationPendingTextRef.current = "";

      if (conversationMode && isConversationActiveRef.current) {
        await sendLiveTurn(trimmed);
      } else {
        await sendWithContext(trimmed, conversationMode);
      }

      if (
        conversationMode &&
        isConversationActiveRef.current &&
        (!settings.ttsEnabled || !("speechSynthesis" in window))
      ) {
        resumeConversationAfterReplyRef.current = false;
        startConversationListening();
      }
    },
    [
      input,
      sendLiveTurn,
      sendWithContext,
      settings.ttsEnabled,
      settings.voiceMode,
      startConversationListening,
      stopConversationListening,
    ],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Bot size={15} />
          AI Assistant
        </div>
        <div className="flex items-center gap-1">
          <button
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => setSettingsOpen((v) => !v)}
            title="AI settings"
          >
            <Settings size={14} />
          </button>
          <button
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={clearConversation}
            title="Clear conversation"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {settingsOpen && (
        <div className="space-y-2 border-b bg-muted/50 p-3 text-xs">
          <label className="block">
            <span className="mb-1 block text-muted-foreground">Gemini API key</span>
            <input
              type="password"
              className="w-full rounded border bg-background px-2 py-1 outline-none focus:ring-1 focus:ring-primary"
              value={settings.apiKey}
              onChange={(e) => setSettings({ apiKey: e.target.value })}
              placeholder="AIza..."
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-muted-foreground">Model</span>
            <select
              className="w-full rounded border bg-background px-2 py-1 outline-none focus:ring-1 focus:ring-primary"
              value={settings.model}
              onChange={(e) => setSettings({ model: e.target.value })}
            >
              {MODELS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-muted-foreground">Voice mode</span>
            <select
              className="w-full rounded border bg-background px-2 py-1 outline-none focus:ring-1 focus:ring-primary"
              value={settings.voiceMode}
              onChange={(e) => {
                const nextVoiceMode = e.target.value as
                  | "off"
                  | "push-to-talk"
                  | "conversation";
                if (nextVoiceMode !== "conversation") {
                  stopConversationMode();
                }
                if (nextVoiceMode !== "push-to-talk") {
                  handlePushToTalkStop();
                }
                setSettings({ voiceMode: nextVoiceMode });
              }}
            >
              <option value="off">Off</option>
              <option value="push-to-talk">Push-to-talk</option>
              <option value="conversation">Conversation</option>
            </select>
          </label>

          <label className="flex items-center gap-2 text-muted-foreground">
            <input
              type="checkbox"
              checked={settings.ttsEnabled}
              onChange={(e) => setSettings({ ttsEnabled: e.target.checked })}
            />
            Speak assistant responses (TTS)
          </label>
        </div>
      )}

      <div ref={listRef} className="flex-1 space-y-3 overflow-auto px-3 py-3">
        {messages.length === 0 && (
          <div className="rounded border bg-muted/40 p-3 text-xs text-muted-foreground">
            Ask anything about the PDF. The assistant can navigate pages and create
            notes/highlights.
          </div>
        )}

        {settings.voiceMode === "conversation" && isConversationActive && (
          <div className="rounded border border-emerald-300/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700">
            Gemini Live mode is active.
            {isListening ? " Listening..." : isThinking ? " Thinking..." : ""}
          </div>
        )}

        {conversationInterimText && settings.voiceMode === "conversation" && (
          <div className="rounded border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            {conversationInterimText}
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              "max-w-[90%] rounded-lg px-3 py-2 text-sm",
              msg.role === "user"
                ? "ml-auto bg-primary text-primary-foreground"
                : "bg-muted text-foreground",
            )}
          >
            <div className="mb-1 flex items-center gap-1 text-[11px] opacity-70">
              {msg.role === "user" ? <MessageSquare size={12} /> : <Bot size={12} />}
              {msg.role === "user" ? "You" : "Assistant"}
            </div>
            <MarkdownMessage content={msg.content} />
          </div>
        ))}

        {isThinking && (
          <div className="inline-flex items-center gap-2 rounded bg-muted px-3 py-2 text-xs text-muted-foreground">
            <Bot size={12} />
            Thinking...
          </div>
        )}

        {error && (
          <div className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
      </div>

      <div className="border-t p-3">
        <form className="flex items-end gap-2" onSubmit={handleSubmit}>
          <textarea
            className="min-h-[2.5rem] flex-1 resize-none rounded border bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary"
            placeholder={
              settings.voiceMode === "conversation"
                ? "Speak or type in conversation mode..."
                : "Ask about this document..."
            }
            value={input}
            rows={2}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />

          {settings.voiceMode === "push-to-talk" && (
            <button
              type="button"
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded border transition-colors",
                isListening
                  ? "border-red-400 bg-red-100 text-red-600"
                  : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
              onMouseDown={handlePushToTalkStart}
              onMouseUp={handlePushToTalkStop}
              onMouseLeave={handlePushToTalkStop}
              onTouchStart={(e) => {
                e.preventDefault();
                handlePushToTalkStart();
              }}
              onTouchEnd={(e) => {
                e.preventDefault();
                handlePushToTalkStop();
              }}
              title="Push to talk"
            >
              {isListening ? <Square size={14} /> : <Mic size={14} />}
            </button>
          )}

          {settings.voiceMode === "conversation" && (
            <button
              type="button"
              className={cn(
                "inline-flex h-10 items-center gap-1 rounded border px-2 text-xs transition-colors",
                isConversationActive
                  ? "border-emerald-400 bg-emerald-100 text-emerald-700"
                  : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
              onClick={toggleConversationMode}
              title={
                isConversationActive
                  ? "Stop conversation mode"
                  : "Start conversation mode"
              }
            >
              {isConversationActive ? <Square size={12} /> : <Mic size={12} />}
              {isConversationActive ? "Stop" : "Talk"}
            </button>
          )}

          <button
            type="submit"
            className="flex h-10 w-10 items-center justify-center rounded bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            disabled={!input.trim() || isThinking}
            title="Send"
          >
            <Send size={14} />
          </button>
        </form>
      </div>
    </div>
  );
}
