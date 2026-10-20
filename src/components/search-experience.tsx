"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Check, ChevronDown, LocateFixed, MapPin, Search, ShieldCheck, Sparkles, Tag } from "lucide-react";
import { BRANDS, SIZES, type DiaperSize, type DiaperStyle, type SearchResult, type SearchSort } from "@/domain/search";
import { lookupCep, type CepLocation } from "@/services/cep";
import { searchMoreOffers, searchOffers } from "@/services/search";
import { formatCep, isValidCep, normalizeCep } from "@/validations/cep";
import { SearchResults } from "./search-results";

type LocationStatus = "idle" | "loading" | "success" | "error";
type ResultStatus = "idle" | "loading" | "success" | "error";

export function SearchExperience() {
  const [cep, setCep] = useState("");
  const [cepLocation, setCepLocation] = useState<CepLocation | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [cepStatus, setCepStatus] = useState<LocationStatus>("idle");
  const [cepError, setCepError] = useState("");
  const [gpsStatus, setGpsStatus] = useState<LocationStatus>("idle");
  const [gpsMessage, setGpsMessage] = useState("");
  const [size, setSize] = useState<DiaperSize | null>(null);
  const [brand, setBrand] = useState<string>(BRANDS[0]);
  const [style, setStyle] = useState<DiaperStyle>("all");
  const [sort, setSort] = useState<SearchSort>("unit-price");
  const [resultStatus, setResultStatus] = useState<ResultStatus>("idle");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [resultError, setResultError] = useState("");
  const [moreLoading, setMoreLoading] = useState(false);
  const [moreError, setMoreError] = useState("");
  const cepRequest = useRef(0);
  const searchRequest = useRef(0);
  const searchController = useRef<AbortController | null>(null);

  useEffect(() => () => { searchRequest.current++; searchController.current?.abort(); }, []);

  function clearSearch() { searchRequest.current++; searchController.current?.abort(); searchController.current = null; setResult(null); setResultStatus("idle"); setMoreLoading(false); setMoreError(""); setSort("unit-price"); }

  function updateCep(value: string) {
    cepRequest.current += 1;
    setCep(formatCep(value));
    setCepLocation(null);
    setConfirmed(false);
    setCepStatus("idle");
    setCepError("");
    clearSearch();
  }

  async function checkCep() {
    if (!isValidCep(cep)) {
      setCepError("Digite um CEP com 8 números.");
      setCepStatus("error");
      return;
    }
    const request = ++cepRequest.current;
    setCepStatus("loading");
    setCepError("");
    try {
      const location = await lookupCep(cep);
      if (request !== cepRequest.current) return;
      setCepLocation(location);
      setCepStatus("success");
      setConfirmed(false);
    } catch (error) {
      if (request !== cepRequest.current) return;
      setCepStatus("error");
      setCepError(error instanceof Error ? error.message : "Falha ao consultar o CEP. Tente novamente.");
    }
  }

  function requestGps() {
    if (!navigator.geolocation) {
      setGpsStatus("error");
      setGpsMessage("Seu navegador não oferece localização. Informe o CEP abaixo.");
      return;
    }
    setGpsStatus("loading");
    setGpsMessage("");
    navigator.geolocation.getCurrentPosition(
      () => {
        setGpsStatus("success");
        setGpsMessage("Localização autorizada. Para buscar ofertas da sua região, informe e confirme seu CEP abaixo.");
      },
      (error) => {
        setGpsStatus("error");
        const messages: Record<number, string> = {
          1: "A localização não foi autorizada. Você pode informar o CEP abaixo.",
          2: "Sua localização está indisponível. Informe o CEP abaixo.",
          3: "A localização demorou demais. Tente novamente ou informe o CEP."
        };
        setGpsMessage(messages[error.code] ?? "Não foi possível obter a localização. Informe o CEP abaixo.");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  }

  async function submitSearch(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!cepLocation || !confirmed || !size) return;
    searchController.current?.abort();
    const controller = new AbortController();
    searchController.current = controller;
    const request = ++searchRequest.current;
    setResultStatus("loading");
    setResultError("");
    try {
      const data = await searchOffers({ cep: normalizeCep(cep), size, brand: brand === BRANDS[0] ? null : brand, style, sort }, controller.signal);
      if (request !== searchRequest.current) return;
      setResult(data);
      setResultStatus("success");
      document.getElementById("resultados")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      if (request !== searchRequest.current) return;
      setResultStatus("error");
      setResultError(error instanceof Error && error.name === "TimeoutError" ? "A busca demorou mais que o esperado. Tente novamente." : error instanceof Error ? error.message : "Tente novamente em alguns instantes.");
    } finally {
      if (request === searchRequest.current) searchController.current = null;
    }
  }

  async function loadMore() {
    if (!result?.progress?.hasMore || moreLoading || !size) return;
    const controller = new AbortController();
    searchController.current?.abort();
    searchController.current = controller;
    const request = ++searchRequest.current;
    setMoreLoading(true);
    setMoreError("");
    try {
      const next = await searchMoreOffers({ cep: normalizeCep(cep), size, brand: brand === BRANDS[0] ? null : brand, style, sort }, result.progress.cursor, controller.signal);
      if (request === searchRequest.current) {
        const source = next.sources.find((item) => item.id === "google-shopping");
        if (source?.status !== "success" || next.count < result.count) setMoreError(source?.reason ?? "Não foi possível ampliar a busca.");
        else setResult(next);
      }
    } catch (error) {
      if (request === searchRequest.current) setMoreError(error instanceof Error ? error.message : "Não foi possível buscar mais ofertas.");
    } finally {
      if (request === searchRequest.current) { setMoreLoading(false); searchController.current = null; }
    }
  }

  return (
    <main>
      <header className="site-header shell">
        <a className="brand-mark" href="#inicio" aria-label="FraldaCerta, início"><span className="brand-icon"><Check size={18} strokeWidth={3} aria-hidden="true" /></span><span>fralda<span className="brand-accent">certa</span><span className="brand-dot">.</span></span></a>
        <a href="#como-funciona" className="header-link">Como funciona <ArrowRight size={15} aria-hidden="true" /></a>
      </header>

      <div id="inicio" className="hero-wrap">
        <div className="shell hero-grid">
          <div className="hero-copy">
            <div className="hero-seal"><span className="seal-pulse" /> Mais clareza para uma escolha de todo dia</div>
            <h1>O melhor preço começa por <em>cada fralda.</em></h1>
            <p className="hero-lead">Encontre opções para o tamanho que você precisa e compare o que realmente importa: o custo por unidade, perto de você.</p>
            <div className="hero-proof"><span className="proof-icon"><ShieldCheck size={19} aria-hidden="true" /></span><span>Busca por região, sem cadastro e sem adivinhação.</span></div>
            <div className="hero-decoration" aria-hidden="true"><div className="decoration-circle"><span>uma escolha<br /><strong>mais leve</strong><Sparkles size={22} /></span></div><div className="decoration-swoosh" /></div>
          </div>

          <form className="search-panel" onSubmit={submitSearch} aria-labelledby="search-title">
            <div className="panel-heading"><div className="panel-heading-icon"><Search size={22} aria-hidden="true" /></div><div><h2 id="search-title">Encontre sua fralda</h2><p>Conte o que você procura. O resto fica mais simples.</p></div></div>

            <div className="form-section location-section">
              <div className="field-title"><span className="step-number">1</span><h3>Onde você está?</h3></div>
              <button className="gps-button" type="button" onClick={requestGps} disabled={gpsStatus === "loading"}><LocateFixed size={19} aria-hidden="true" />{gpsStatus === "loading" ? "Obtendo localização…" : "Usar minha localização"}<ArrowRight size={17} aria-hidden="true" /></button>
              {gpsMessage && <p className={`field-feedback ${gpsStatus === "error" ? "feedback-error" : "feedback-success"}`} role="status">{gpsMessage}</p>}
              <div className="divider"><span>ou informe seu CEP</span></div>
              <label className="input-label" htmlFor="cep">CEP da região de entrega</label>
              <div className="cep-row"><div className="cep-input-wrap"><MapPin size={18} aria-hidden="true" /><input id="cep" name="cep" inputMode="numeric" autoComplete="postal-code" placeholder="00000-000" value={cep} onChange={(event) => updateCep(event.target.value)} aria-invalid={cepStatus === "error"} aria-describedby={cepStatus === "error" ? "cep-error" : "cep-help"} /></div><button type="button" className="cep-check" onClick={checkCep} disabled={cepStatus === "loading"}>{cepStatus === "loading" ? "Consultando…" : "Consultar"}</button></div>
              {cepStatus === "error" ? <p id="cep-error" className="field-feedback feedback-error" role="alert">{cepError}</p> : <p id="cep-help" className="input-help">Usamos o CEP para identificar sua cidade e UF.</p>}
              {cepLocation && <div className="location-confirm"><div className="location-confirm-top"><MapPin size={17} aria-hidden="true" /><span><strong>{cepLocation.city}, {cepLocation.state}</strong><small>CEP {formatCep(cepLocation.cep)}</small></span></div><label className="confirm-row"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>Confirmo que este é o CEP para minha busca</span></label></div>}
            </div>

            <div className="form-section"><div className="field-title"><span className="step-number">2</span><h3>Qual tamanho?</h3></div><div className="size-options" role="group" aria-label="Tamanho da fralda">{SIZES.map((item) => <button key={item} type="button" className={`size-button ${size === item ? "selected" : ""}`} onClick={() => { setSize(item); clearSearch(); }} aria-pressed={size === item}>{item}</button>)}</div></div>

            <div className="form-section"><div className="field-title"><span className="step-number">3</span><h3>Suas preferências</h3></div><label className="input-label" htmlFor="brand">Marca</label><div className="select-wrap"><Tag size={18} aria-hidden="true" /><select id="brand" value={brand} onChange={(event) => { setBrand(event.target.value); clearSearch(); }}>{BRANDS.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={17} aria-hidden="true" /></div><span className="input-label type-label">Tipo de fralda</span><div className="style-options" role="group" aria-label="Tipo de fralda">{([{ value: "all", label: "Todos" }, { value: "tape", label: "Fita" }, { value: "pants", label: "Calça" }] as const).map((item) => <button key={item.value} type="button" className={style === item.value ? "active" : ""} onClick={() => { setStyle(item.value); clearSearch(); }} aria-pressed={style === item.value}>{item.label}</button>)}</div></div>

            <button className="submit-button" type="submit" disabled={!confirmed || !size || resultStatus === "loading"}>Encontrar melhores preços <ArrowRight size={19} aria-hidden="true" /></button><p className="submit-hint">{!confirmed || !size ? "Confirme seu CEP e selecione o tamanho para continuar." : "Tudo pronto para buscar na sua região."}</p>
          </form>
        </div>
      </div>

      <SearchResults state={resultStatus} result={result} error={resultError} onRetry={() => void submitSearch()} location={cepLocation} sort={sort} onSortChange={setSort} onMore={() => void loadMore()} moreLoading={moreLoading} moreError={moreError} />
      <section id="como-funciona" className="how-section shell"><div><h2>Escolhas melhores, com menos contas.</h2><p>O preço do pacote é só parte da história. A FraldaCerta mostra o valor por fralda nas ofertas verificadas entre as fontes consultadas.</p></div><div className="how-note"><span className="note-mark"><Check size={21} strokeWidth={3} aria-hidden="true" /></span><p>Consultamos fontes autorizadas e avisamos quando o frete não pôde ser cotado para o seu CEP.</p></div></section>
      <footer className="site-footer shell"><span>fralda<span className="brand-accent">certa</span><span className="brand-dot">.</span></span><small>Feito para simplificar escolhas do dia a dia.</small></footer>
    </main>
  );
}
