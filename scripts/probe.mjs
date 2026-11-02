// Diagnóstico: conecta, negocia STARTTLS y muestra mecanismos SASL sin autenticarse.
// Uso: npm run probe -- <servidor> [puerto] [dominio]
import { client } from "@xmpp/client";
const [host, port = "5222", domain = host] = process.argv.slice(2);
if (!host) {
  console.error("Uso: npm run probe -- <servidor> [puerto] [dominio]");
  process.exit(1);
}
const xmpp = client({
  service: `xmpp://${host}:${port}`, domain, timeout: 15000,
  credentials: async (_auth, mechanisms, _fast, entity) => {
    console.log("TLS:", entity.isSecure(), entity.socket?.socket?.getProtocol?.());
    const cert = entity.socket?.socket?.getPeerCertificate?.();
    console.log("Cert subject:", cert?.subject?.CN, "valid to:", cert?.valid_to);
    console.log("SASL:", mechanisms);
    throw new Error("PROBE_DONE");
  },
});
xmpp.reconnect.stop();
xmpp.on("error", (e) => { if (e.message !== "PROBE_DONE") console.error("error:", e.message); });
xmpp.on("status", (s) => console.log("status:", s));
xmpp.start().catch((e) => console.log("end:", e.message)).finally(() => process.exit(0));
