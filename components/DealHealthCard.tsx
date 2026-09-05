import Link from "next/link";
import {
  isDiscountAnomaly,
  isStalled,
  type DealHealthQuotation,
} from "@/lib/business-logic";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** B9 — one quotation on the deal-health board, badged by its health signals. */
export function DealHealthCard({ quotation }: { quotation: DealHealthQuotation }) {
  const stalled = isStalled(quotation);
  const anomalous = isDiscountAnomaly(quotation);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Link href={`/quotations/${quotation.id}`} className="hover:underline">
            {quotation.reference ?? quotation.id}
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{quotation.status ?? "—"}</span>
          <span className="tabular-nums">{quotation.net_total ?? 0}</span>
        </div>

        <div className="flex flex-wrap gap-1">
          {stalled ? <Badge variant="secondary">Stalled</Badge> : null}
          {anomalous ? <Badge variant="destructive">Discount anomaly</Badge> : null}
          {!stalled && !anomalous ? (
            <Badge variant="outline">Healthy</Badge>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
