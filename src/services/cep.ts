import { normalizeCep } from "@/validations/cep";

export interface CepLocation {
  cep: string;
  city: string;
  state: string;
}

type ViaCepResponse = { erro?: boolean; cep?: string; localidade?: string; uf?: string };

export async function lookupCep(cep: string, signal?: AbortSignal): Promise<CepLocation> {
  const response = await fetch(`https://viacep.com.br/ws/${normalizeCep(cep)}/json/`, { signal });
  if (!response.ok) throw new Error("Não foi possível consultar o CEP. Tente novamente.");
  const data = (await response.json()) as ViaCepResponse;
  if (data.erro) throw new Error("CEP não encontrado. Confira os números e tente novamente.");
  if (!data.localidade || !data.uf) throw new Error("Resposta incompleta do serviço de CEP. Tente novamente.");
  return { cep: normalizeCep(cep), city: data.localidade, state: data.uf };
}
