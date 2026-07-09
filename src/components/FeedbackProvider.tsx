import React, { createContext, useContext, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useLanguage } from "./LanguageProvider";

type NoticeTone = "success" | "error" | "warning" | "info";

interface Notice {
  id: number;
  message: string;
  tone: NoticeTone;
}

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
}

interface PromptOptions extends ConfirmOptions {
  inputLabel?: string;
  placeholder?: string;
  defaultValue?: string;
  inputType?: "text" | "number";
}

interface DialogState {
  kind: "confirm" | "prompt";
  options: ConfirmOptions | PromptOptions;
  value: string;
  resolve: (value: boolean | string | null) => void;
}

interface FeedbackContextValue {
  notify: (message: string, tone?: NoticeTone) => void;
  confirmAction: (options: ConfirmOptions) => Promise<boolean>;
  promptAction: (options: PromptOptions) => Promise<string | null>;
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

export function useFeedback() {
  const context = useContext(FeedbackContext);
  if (!context) throw new Error("useFeedback must be used within FeedbackProvider.");
  return context;
}

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const { language } = useLanguage();
  const isEnglish = language === "en";
  const [notices, setNotices] = useState<Notice[]>([]);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const noticeId = useRef(0);

  const notify = (message: string, tone: NoticeTone = "info") => {
    const id = ++noticeId.current;
    setNotices(current => [...current, { id, message, tone }]);
    window.setTimeout(() => {
      setNotices(current => current.filter(notice => notice.id !== id));
    }, 4500);
  };

  const confirmAction = (options: ConfirmOptions) => new Promise<boolean>(resolve => {
    setDialog({
      kind: "confirm",
      options,
      value: "",
      resolve: value => resolve(Boolean(value))
    });
  });

  const promptAction = (options: PromptOptions) => new Promise<string | null>(resolve => {
    setDialog({
      kind: "prompt",
      options,
      value: options.defaultValue || "",
      resolve: value => resolve(typeof value === "string" ? value : null)
    });
  });

  const closeDialog = (result: boolean | string | null) => {
    if (!dialog) return;
    dialog.resolve(result);
    setDialog(null);
  };

  const noticeStyles: Record<NoticeTone, string> = {
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    error: "border-rose-200 bg-rose-50 text-rose-800",
    warning: "border-amber-200 bg-amber-50 text-amber-800",
    info: "border-blue-200 bg-blue-50 text-dark-blue"
  };
  const NoticeIcon = ({ tone }: { tone: NoticeTone }) => {
    if (tone === "success") return <CheckCircle2 className="h-4 w-4" />;
    if (tone === "error") return <XCircle className="h-4 w-4" />;
    if (tone === "warning") return <AlertTriangle className="h-4 w-4" />;
    return <Info className="h-4 w-4" />;
  };

  const promptOptions = dialog?.kind === "prompt" ? dialog.options as PromptOptions : null;

  return (
    <FeedbackContext.Provider value={{ notify, confirmAction, promptAction }}>
      {children}

      <div className="pointer-events-none fixed right-4 top-4 z-[120] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
        {notices.map(notice => (
          <div
            key={notice.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-xl border p-3 shadow-lg ${noticeStyles[notice.tone]}`}
            role="status"
          >
            <NoticeIcon tone={notice.tone} />
            <p className="flex-1 text-xs font-semibold leading-relaxed">{notice.message}</p>
            <button
              type="button"
              onClick={() => setNotices(current => current.filter(item => item.id !== notice.id))}
              className="rounded p-0.5 opacity-60 hover:bg-white/60 hover:opacity-100"
              aria-label={isEnglish ? "Close message" : "Cerrar mensaje"}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      {dialog && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/40 p-4">
          <div
            className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-dialog-title"
          >
            <div className="flex items-start gap-3 border-b border-slate-100 bg-slate-50 px-5 py-4">
              <div className={`rounded-xl p-2 ${dialog.options.tone === "danger" ? "bg-rose-100 text-rose-600" : "bg-blue-100 text-primary-blue"}`}>
                {dialog.options.tone === "danger" ? <AlertTriangle className="h-5 w-5" /> : <Info className="h-5 w-5" />}
              </div>
              <div className="flex-1">
                <h3 id="feedback-dialog-title" className="font-display text-sm font-bold text-slate-900">
                  {dialog.options.title || (isEnglish ? "Confirm action" : "Confirmar acción")}
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">{dialog.options.message}</p>
              </div>
              <button type="button" onClick={() => closeDialog(dialog.kind === "confirm" ? false : null)} className="rounded-lg p-1 text-slate-400 hover:bg-white hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>

            {promptOptions && (
              <div className="px-5 pt-4">
                {promptOptions.inputLabel && <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-slate-500">{promptOptions.inputLabel}</label>}
                <input
                  autoFocus
                  type={promptOptions.inputType || "text"}
                  value={dialog.value}
                  onChange={event => setDialog(current => current ? { ...current, value: event.target.value } : current)}
                  onKeyDown={event => {
                    if (event.key === "Enter" && dialog.value.trim()) closeDialog(dialog.value.trim());
                  }}
                  placeholder={promptOptions.placeholder}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-primary-blue focus:bg-white"
                />
              </div>
            )}

            <div className="flex justify-end gap-2 p-5">
              <button
                type="button"
                onClick={() => closeDialog(dialog.kind === "confirm" ? false : null)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                {dialog.options.cancelLabel || (isEnglish ? "Cancel" : "Cancelar")}
              </button>
              <button
                type="button"
                onClick={() => closeDialog(dialog.kind === "confirm" ? true : dialog.value.trim())}
                disabled={dialog.kind === "prompt" && !dialog.value.trim()}
                className={`rounded-xl px-4 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-40 ${dialog.options.tone === "danger" ? "bg-rose-600 hover:bg-rose-700" : "bg-primary-blue hover:bg-secondary-blue"}`}
              >
                {dialog.options.confirmLabel || (isEnglish ? "Confirm" : "Confirmar")}
              </button>
            </div>
          </div>
        </div>
      )}
    </FeedbackContext.Provider>
  );
}
