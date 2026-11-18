"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ShieldCheck, X } from "lucide-react";
import type { Company } from "../market/data";
import { blackScholes, profitMetrics } from "../../cores/index";

export type PaperOrder = {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  type: "call" | "put";
  strike: number;
  expiry: string;
  quantity: number;
  premium: number;
  total: number;
  createdAt: string;
  status: "Simulada";
  operationStart: string;
  operationEnd: string;
  startTime: string;
  endTime: string;
};

type Props = {
  company: Company;
  operationStart: string;
  operationEnd: string;
  startTime: string;
  endTime: string;
  rate: number;
  onClose: () => void;
  onSubmit: (order: PaperOrder) => void;
};

const usd = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
const validDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const validCents = (value: number) => Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
const daysBetween = (start: string, end: string) => Math.max(0, Math.ceil((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000));
const displayDate = (date: string) => {
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(parsed) : date;
};

export default function OrderTicket({ company, operationStart, operationEnd, startTime, endTime, rate, onClose, onSubmit }: Props) {
  const titleId = useId();
  const errorId = useId();
  const modalRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [type, setType] = useState<"call" | "put">("call");
  const [strike, setStrike] = useState(String(Math.round(company.price / 5) * 5 || 5));
  const [expiry, setExpiry] = useState(operationEnd);
  const [quantity, setQuantity] = useState("1");
  const [premium, setPremium] = useState(() => {
    try {
      return Math.max(0.01, blackScholes({ spot: company.price, strike: Math.round(company.price / 5) * 5 || 5, days: daysBetween(operationStart, operationEnd), volatility: company.iv, rate, dividendYield: company.dividendYield, type: "call" }).price).toFixed(2);
    } catch {
      return "1.00";
    }
  });
  const [review, setReview] = useState(false);
  const [error, setError] = useState("");
  const submitted = useRef(false);

  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modalRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      if (event.key !== "Tab" || !modalRef.current) return;
      const elements = Array.from(modalRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]')).filter(element => element.getClientRects().length > 0);
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first || !last) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === modalRef.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === modalRef.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKey);
      previous?.focus();
    };
  }, []);

  useEffect(() => {
    if (review) modalRef.current?.focus();
  }, [review]);

  const days = daysBetween(operationStart, expiry);
  const model = useMemo(() => {
    try {
      const inputs = { spot: company.price, strike: Number(strike), days, volatility: company.iv, rate, dividendYield: company.dividendYield, type };
      return { ...blackScholes(inputs), ...profitMetrics({ ...inputs, premium: Number(premium), side }) };
    } catch { return null; }
  }, [company, strike, days, rate, type, premium, side]);
  const total = Number(quantity) * 100 * Number(premium);

  function validate() {
    if (!validDate(operationStart) || !validDate(operationEnd) || operationStart > operationEnd) return "Corrige el rango de fechas de operación antes de simular.";
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(endTime) || startTime >= endTime || startTime < "09:30" || endTime > "16:00") return "Elige una ventana entre 09:30 y 16:00 ET, con la hora inicial anterior a la final.";
    if (!validDate(expiry) || !Number.isFinite(days) || expiry < operationStart || expiry > operationEnd) return "El vencimiento debe estar dentro del rango de operación.";
    if (!Number.isFinite(Number(strike)) || Number(strike) <= 0) return "Escribe un strike mayor que cero.";
    if (!validCents(Number(strike))) return "El strike debe tener como máximo dos decimales y una cantidad válida.";
    if (!Number.isInteger(Number(quantity)) || Number(quantity) < 1 || Number(quantity) > 100) return "Elige entre 1 y 100 contratos completos.";
    if (!Number.isFinite(Number(premium)) || Number(premium) <= 0) return "La prima límite debe ser mayor que cero.";
    if (!validCents(Number(premium))) return "La prima límite debe tener como máximo dos decimales y una cantidad válida.";
    if (!Number.isFinite(total) || !Number.isSafeInteger(Math.round(total * 100)) || !model) return "No fue posible calcular el contrato. Revisa los valores.";
    return "";
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const message = validate();
    setError(message);
    if (message) return;
    if (!review) { setReview(true); return; }
    if (submitted.current) return;
    submitted.current = true;
    try {
      onSubmit({ id: crypto.randomUUID(), symbol: company.symbol, side, type, strike: Number(strike), expiry, quantity: Number(quantity), premium: Number(premium), total: Math.round(total * 100) / 100, createdAt: new Date().toISOString(), status: "Simulada", operationStart, operationEnd, startTime, endTime });
    } catch {
      submitted.current = false;
      setError("No se pudo guardar la simulación. Inténtalo de nuevo.");
    }
  }

  return (
    <div className="ticket-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={modalRef} className="ticket-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="ticket-header">
          <div><div className="ticket-eyebrow"><span /> SIMULACIÓN DE OPCIONES</div><h2 id={titleId}>{review ? "Revisa tu simulación" : "Nueva operación"}</h2></div>
          <button type="button" className="ticket-icon" aria-label="Cerrar operación" onClick={onClose}><X size={19} /></button>
        </header>
        <div className="ticket-asset"><div className="ticket-symbol" style={{ color: company.color }}>{company.initials}</div><div><strong>{company.symbol}</strong><span>{company.name}</span></div><div className="ticket-asset-price"><strong>{usd(company.price)}</strong><span>Subyacente · dato simulado</span></div></div>
        <form onSubmit={submit} noValidate>
          {review ? (
            <div className="ticket-review">
              <div className="ticket-review-banner"><ShieldCheck size={21} /><div><strong>Tu operación está lista para simular</strong><span>Se guardará en el almacenamiento seleccionado, sin enviar una orden a Alpaca ni al mercado.</span></div></div>
              <dl className="ticket-summary">
                <div><dt>Operación</dt><dd>{side === "buy" ? "Compra" : "Venta"} de {type.toUpperCase()}</dd></div>
                <div><dt>Contratos</dt><dd>{quantity} × 100 acciones</dd></div>
                <div><dt>Strike</dt><dd>{usd(Number(strike))}</dd></div>
                <div><dt>Vencimiento</dt><dd>{displayDate(expiry)}</dd></div>
                <div><dt>Prima límite por acción</dt><dd>{usd(Number(premium))}</dd></div>
                <div><dt>Inicio de operación</dt><dd>{displayDate(operationStart)}</dd></div>
                <div><dt>Fin de operación</dt><dd>{displayDate(operationEnd)}</dd></div>
                <div><dt>Ventana configurada</dt><dd>{startTime}–{endTime} ET</dd></div>
                <div><dt>Fecha base del modelo</dt><dd>{displayDate(operationStart)}</dd></div>
                <div className="ticket-summary-total"><dt>{side === "buy" ? "Débito simulado" : "Crédito simulado"}</dt><dd>{usd(total)}</dd></div>
              </dl>
              <p className="ticket-note">El total corresponde únicamente a las primas y no incluye comisiones, garantía ni capital necesario por asignación. La simulación registra la intención y no reproduce una ejecución.</p>
            </div>
          ) : (
            <>
              <div className="ticket-segment ticket-side" role="group" aria-label="Lado de la operación">{(["buy", "sell"] as const).map(value => <button type="button" key={value} aria-pressed={side === value} className={side === value ? "is-active" : ""} onClick={() => setSide(value)}>{value === "buy" ? "Comprar" : "Vender"}</button>)}</div>
              <div className="ticket-segment" role="group" aria-label="Tipo de opción">{(["call", "put"] as const).map(value => <button type="button" key={value} aria-pressed={type === value} className={type === value ? "is-active" : ""} onClick={() => setType(value)}>{value.toUpperCase()} <span>{value === "call" ? "Derecho de compra" : "Derecho de venta"}</span></button>)}</div>
              <div className="ticket-fields">
                <label>Strike · USD<input type="number" min="0.01" step="0.01" inputMode="decimal" value={strike} onChange={event => setStrike(event.target.value)} required /></label>
                <label>Vencimiento<input type="date" min={operationStart} max={operationEnd} value={expiry} onChange={event => setExpiry(event.target.value)} required /></label>
                <label>Contratos<input type="number" min="1" max="100" step="1" inputMode="numeric" value={quantity} onChange={event => setQuantity(event.target.value)} required /></label>
                <label>Prima límite · USD<input type="number" min="0.01" step="0.01" inputMode="decimal" value={premium} onChange={event => setPremium(event.target.value)} required /></label>
              </div>
              <div className="ticket-fair"><span>Precio teórico BSM <strong>{model ? usd(model.price) : "—"}</strong></span><button type="button" disabled={!model} onClick={() => model && setPremium(Math.max(0.01, model.price).toFixed(2))}>Usar precio</button></div>
              <div className="ticket-model"><div className="ticket-model-heading"><span>RIESGO DEL CONTRATO</span><small>F0 · Black–Scholes–Merton</small></div><div className="ticket-greeks">{[{ label: "Delta", value: model?.delta, digits: 3 }, { label: "Gamma", value: model?.gamma, digits: 4 }, { label: "Theta / día", value: model?.theta, digits: 3 }, { label: "Vega / 1%", value: model?.vega, digits: 3 }].map(metric => <div key={metric.label}><span>{metric.label}</span><strong>{metric.value?.toFixed(metric.digits) ?? "—"}</strong></div>)}</div><div className="ticket-probability"><span>Equilibrio <strong>{model ? usd(model.breakeven) : "—"}</strong></span><span>Prob. de beneficio <strong>{model ? `${(model.probabilityOfProfit * 100).toFixed(1)}%` : "—"}</strong></span></div><p>Estimación neutral al riesgo al vencimiento, bajo supuestos BSM; no es una probabilidad histórica ni garantiza resultados. Precio y volatilidad simulados. Modelo europeo, sin ejercicio anticipado.</p></div>
              <div className="ticket-window"><span>Ventana de operación</span><strong>{startTime}–{endTime} ET</strong><small>{displayDate(operationStart)} — {displayDate(operationEnd)}</small></div>
              <div className="ticket-cost"><span>{side === "buy" ? "Débito simulado" : "Crédito simulado"}<small>{Number.isInteger(Number(quantity)) ? quantity : "—"} contratos × 100 × prima</small></span><strong>{Number.isFinite(total) && total >= 0 ? usd(total) : "—"}</strong></div>
            </>
          )}
          {error && <p className="ticket-error" role="alert" id={errorId}>{error}</p>}
          <footer className="ticket-footer"><button type="button" className="ticket-back" onClick={() => { if (review) { setReview(false); setError(""); } else onClose(); }}>{review ? <><ArrowLeft size={15} /> Editar</> : "Cancelar"}</button><button type="submit" className="ticket-primary">{review ? <><Check size={16} /> Confirmar simulación</> : <>Revisar operación <ArrowRight size={16} /></>}</button></footer>
          <p className="ticket-disclaimer">SIMULACIÓN LOCAL · SIN DINERO REAL · 1 CONTRATO = 100 ACCIONES</p>
        </form>
      </div>
      <style>{`
        .ticket-overlay{position:fixed;inset:0;z-index:1000;background:rgba(3,5,7,.78);backdrop-filter:blur(7px);display:flex;align-items:center;justify-content:center;padding:24px;color:#f4f4f5;font:inherit;font-size:13px}
        .ticket-dialog{width:100%;max-width:560px;max-height:calc(100dvh - 48px);overflow:auto;background:#151719;border:1px solid #303338;border-radius:16px;box-shadow:0 30px 100px #0009;outline:none}
        .ticket-dialog *{box-sizing:border-box}.ticket-dialog button{cursor:pointer;font:inherit}.ticket-dialog button:focus-visible,.ticket-dialog input:focus-visible{outline:2px solid #ff813b;outline-offset:3px}.ticket-header{display:flex;align-items:center;justify-content:space-between;padding:25px 27px 21px;border-bottom:1px solid #292c30}.ticket-eyebrow{font-size:10px;letter-spacing:1.6px;color:#a4a6ad;display:flex;gap:7px;align-items:center}.ticket-eyebrow>span{width:5px;height:5px;background:#ff813b;border-radius:50%}.ticket-header h2{font-size:23px;font-weight:600;letter-spacing:-.6px;margin:9px 0 0}.ticket-icon{display:grid;place-items:center;width:32px;height:32px;border:1px solid #303338;border-radius:7px;background:#1d2023;color:#a7aab0}.ticket-icon:hover{color:#fff;background:#2a2d31}.ticket-asset{display:flex;align-items:center;gap:11px;padding:19px 27px;background:#121416}.ticket-symbol{background:#24272b;border:1px solid #34373c;width:40px;height:40px;border-radius:10px;display:grid;place-items:center;font-size:14px;font-weight:700}.ticket-asset strong{display:block;font-size:15px;font-weight:600}.ticket-asset span{display:block;margin-top:4px;font-size:10px;color:#858991}.ticket-asset-price{margin-left:auto;text-align:right}.ticket-dialog form{padding:23px 27px 18px}.ticket-segment{display:flex;gap:6px;background:#101214;padding:4px;border-radius:8px;border:1px solid #26292d;margin-bottom:14px}.ticket-segment button{flex:1;border:0;border-radius:5px;background:transparent;color:#93969d;padding:9px 7px;font-size:12px}.ticket-segment button span{display:block;font-size:9px;margin-top:3px;color:#858991}.ticket-segment button.is-active{color:#ff9b64;background:#38251b;box-shadow:inset 0 0 0 1px #704023}.ticket-side button{font-size:13px;font-weight:600;padding:10px}.ticket-fields{display:grid;grid-template-columns:1fr 1fr;gap:15px 17px;margin:20px 0 12px}.ticket-fields label{font-size:11px;color:#a2a5ac;display:flex;flex-direction:column;gap:8px}.ticket-fields input{min-width:0;width:100%;height:40px;border:1px solid #34373d;border-radius:6px;background:#1b1e21;color:#eef0f2;padding:0 11px;font:inherit;font-size:12px;color-scheme:dark}.ticket-fair{display:flex;justify-content:space-between;align-items:center;font-size:10px;color:#878b93;margin-bottom:18px}.ticket-fair strong{color:#c9cbd0;margin-left:6px;font-weight:500}.ticket-fair button{background:none;border:0;color:#e7925f;font-size:10px;padding:5px}.ticket-fair button:disabled{opacity:.4;cursor:default}.ticket-model{background:#111315;border:1px solid #2a2d31;border-radius:8px;padding:14px}.ticket-model-heading{display:flex;align-items:center;justify-content:space-between;gap:6px}.ticket-model-heading>span{font-size:9px;letter-spacing:1.2px;color:#c0c3c9}.ticket-model-heading>small{font-size:9px;color:#747981}.ticket-greeks{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:16px 0}.ticket-greeks span{font-size:9px;color:#80858d;display:block}.ticket-greeks strong{font-size:13px;font-weight:500;display:block;margin-top:6px;font-variant-numeric:tabular-nums}.ticket-probability{border-top:1px solid #282b2f;padding-top:12px;display:flex;justify-content:space-between;gap:8px;font-size:10px;color:#93979e}.ticket-probability strong{display:block;margin-top:6px;color:#50c7a9;font-size:13px;font-weight:500}.ticket-probability>span:last-child{text-align:right}.ticket-model p{font-size:9px;line-height:1.6;color:#737982;margin:12px 0 0}.ticket-window{display:grid;grid-template-columns:1fr auto;gap:5px;font-size:10px;color:#858a93;margin:17px 0}.ticket-window strong{font-weight:500;color:#c3c6cb}.ticket-window small{grid-column:1/-1;font-size:9px;color:#666d76}.ticket-cost{display:flex;justify-content:space-between;align-items:center;padding-top:16px;border-top:1px solid #2a2d31;font-size:12px;color:#a9adb5}.ticket-cost small{display:block;font-size:9px;color:#6d747d;margin-top:6px}.ticket-cost>strong{font-size:24px;font-weight:500;letter-spacing:-.7px;color:#fff}.ticket-footer{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-top:22px}.ticket-back{display:flex;gap:6px;align-items:center;background:none;border:0;color:#989da6;padding:10px 0;font-size:11px}.ticket-primary{display:flex;align-items:center;justify-content:center;gap:10px;border:1px solid #ff985d;border-radius:6px;background:#ff813b;color:#201308;padding:12px 17px;font-size:12px;font-weight:600}.ticket-primary:hover{background:#ff965a}.ticket-disclaimer{text-align:center;font-size:8px;letter-spacing:.65px;color:#666d76;margin:16px 0 0;line-height:1.6}.ticket-error{color:#f5a6a6;background:#3b2025;border:1px solid #68333b;padding:10px;border-radius:5px;font-size:11px;line-height:1.5;margin-top:15px}.ticket-review-banner{display:flex;align-items:center;gap:12px;padding:14px;background:#1c3029;border:1px solid #2e5143;border-radius:8px;color:#5bccaa}.ticket-review-banner strong{display:block;font-size:12px;font-weight:500}.ticket-review-banner span{display:block;font-size:10px;line-height:1.5;margin-top:5px;color:#8dafa2}.ticket-summary{margin:23px 0 0}.ticket-summary>div{display:flex;justify-content:space-between;gap:14px;padding:10px 0;font-size:12px}.ticket-summary dt{color:#8f959f}.ticket-summary dd{color:#e4e6e9;margin:0;text-align:right}.ticket-summary .ticket-summary-total{border-top:1px solid #2a2d31;margin-top:11px;padding-top:21px;align-items:center}.ticket-summary-total dd{font-size:26px;font-weight:500;letter-spacing:-.5px;color:#ff9b64}.ticket-note{font-size:10px;color:#7f8690;line-height:1.7;margin:17px 0 0}@media(max-width:560px){.ticket-overlay{padding:12px}.ticket-dialog{max-height:calc(100dvh - 24px);border-radius:12px}.ticket-header{padding:20px}.ticket-asset{padding:15px 20px}.ticket-dialog form{padding:19px 20px 16px}.ticket-model-heading{align-items:flex-start;flex-direction:column;gap:5px}.ticket-asset-price strong{font-size:14px}.ticket-asset-price span{font-size:8px}.ticket-primary{padding:11px 12px;font-size:11px}.ticket-header h2{font-size:21px}.ticket-fields{gap:13px}.ticket-probability{font-size:9px}}
      `}</style>
    </div>
  );
}

