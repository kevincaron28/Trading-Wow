import { render } from "preact";
import "./styles.css";
import { App } from "./ui/App";
import { linkState, setState } from "./app/store";

// A link from the Discord recap (?house=113&item=22457): open it, then drop the query so a reload does not repeat it.
const link = linkState(location.search);
if (link) {
  setState(link);
  history.replaceState(null, "", location.pathname + location.hash);
}

render(<App />, document.getElementById("app")!);
