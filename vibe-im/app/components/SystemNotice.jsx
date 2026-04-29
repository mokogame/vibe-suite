import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

const SystemNoticeContext = createContext(null);

function noticeMessage(input) {
  if (!input) return "请求失败";
  if (input instanceof Error) return input.message || "请求失败";
  return String(input);
}

export function SystemNoticeProvider({ children }) {
  const [notice, setNotice] = useState(null);
  const timerRef = useRef(null);

  const showSystemNotice = useCallback((input, options = {}) => {
    const level = options.level || (input instanceof Error ? "error" : "info");
    const message = noticeMessage(input);
    const duration = options.duration ?? (level === "error" ? 3200 : 2400);

    if (timerRef.current) clearTimeout(timerRef.current);
    setNotice({ id: Date.now(), level, message });
    timerRef.current = setTimeout(() => {
      setNotice(null);
      timerRef.current = null;
    }, duration);
  }, []);

  const value = useMemo(() => ({
    showSystemNotice,
    showError: error => showSystemNotice(error, { level: "error" }),
    showNotice: text => showSystemNotice(text, { level: "success" })
  }), [showSystemNotice]);

  return (
    <SystemNoticeContext.Provider value={value}>
      {children}
      {notice && (
        <div className={`systemNotice ${notice.level}`} role="status" aria-live="polite">
          {notice.message}
        </div>
      )}
    </SystemNoticeContext.Provider>
  );
}

export function useSystemNotice() {
  const context = useContext(SystemNoticeContext);
  if (!context) throw new Error("useSystemNotice must be used inside SystemNoticeProvider");
  return context;
}
