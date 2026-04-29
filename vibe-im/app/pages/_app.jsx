import "@/styles/globals.css";
import { SystemNoticeProvider } from "../components/SystemNotice";

export default function App({ Component, pageProps }) {
  return (
    <SystemNoticeProvider>
      <Component {...pageProps} />
    </SystemNoticeProvider>
  );
}
