import { useParams } from "react-router-dom";
import { typeOfKey } from "@/lib/nodes";
import { Relations } from "./common";
import { ComponentView } from "./ComponentView";
import { ApiView } from "./ApiView";
import { EndpointView } from "./EndpointView";
import { TopicView } from "./TopicView";
import { DatasetView } from "./DatasetView";
import { LibraryView } from "./LibraryView";
import { GroupView } from "./GroupView";

/**
 * Página de um nó, pela chave (`/n/<chave>`). Cada tipo com ferramenta própria usa a dela; os demais (sistema,
 * domínio, recurso, pessoa, tecnologia, repositório, contrato) usam o node_get. Um nome em vez da chave também
 * serve: a API resolve, ou devolve os candidatos.
 */
export function NodePage() {
  const { key = "" } = useParams();
  switch (typeOfKey(key)) {
    case "Component":
      return <ComponentView nodeKey={key} />;
    case "Api":
      return <ApiView nodeKey={key} />;
    case "Endpoint":
      return <EndpointView nodeKey={key} />;
    case "Topic":
      return <TopicView nodeKey={key} />;
    case "Dataset":
      return <DatasetView nodeKey={key} />;
    case "Library":
      return <LibraryView nodeKey={key} />;
    case "Group":
      return <GroupView nodeKey={key} />;
    default:
      return <Relations key={key} nodeKey={key} header />;
  }
}
