"use client";

import { useState } from "react";
import { CategoryMixCard } from "./category-mix-card";
import { PipelineChart } from "./pipeline-chart";
import { PipelineValueCard } from "./pipeline-value-card";
import { RecentQuotations } from "./recent-quotations";
import { RepHeader } from "./rep-header";
import { StatCards } from "./stat-cards";
import { StatusMixCard } from "./status-mix-card";
import { TopCustomerCard } from "./top-customer-card";
import type { RepDashboardData } from "./data";

export function RepDashboard({ data }: { data: RepDashboardData }) {
  // Held here so the header's search box filters the table below it.
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      <RepHeader search={search} onSearchChange={setSearch} />

      {data.loadError ? (
        <p className="rounded-xl bg-amber-500/10 p-3 text-xs text-amber-700 ring-1 ring-amber-500/30 dark:text-amber-400">
          Could not load your quotations: {data.loadError}
        </p>
      ) : null}

      <StatCards stats={data.stats} />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="flex flex-col gap-4 xl:col-span-2">
          <PipelineChart data={data.pipeline} />
          <CategoryMixCard slices={data.categoryMix} />
        </div>

        <div className="flex flex-col gap-4">
          <PipelineValueCard value={data.pipelineValue} />
          <StatusMixCard slices={data.statusMix} />
          <TopCustomerCard customer={data.topCustomer} />
        </div>
      </div>

      <RecentQuotations
        quotations={data.recent}
        search={search}
        status={status}
        onStatusChange={setStatus}
      />
    </div>
  );
}
