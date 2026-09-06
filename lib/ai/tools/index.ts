/**
 * Side-effect barrel: importing this file registers every tool. `service.ts`
 * imports it once, before any request is handled. Adding a tool means adding a
 * module here — nothing else in the pipeline needs to know it exists.
 */
import "./quotations";
import "./approvals";
import "./deal-health";
import "./billing";
import "./reports";
import "./catalog";
import "./workspace";
import "./explain";
import "./drafting";
import "./risk";
import "./anomalies";
import "./prepare";
import "./audit";
import "./trace";
