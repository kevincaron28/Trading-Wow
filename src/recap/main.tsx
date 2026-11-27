import { render } from "preact";
import "../styles.css";
import "./recap.css";
import { RecapShare, parseShareParams } from "./RecapShare";

const params = parseShareParams(location.search);
document.documentElement.lang = params.lang;
render(<RecapShare {...params} />, document.getElementById("recap")!);
