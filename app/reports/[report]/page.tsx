import { notFound } from 'next/navigation';
import ReportView from '../report-view';
import { reportKeys } from '@/lib/reports';

export default function ReportPage({ params }: { params: { report: string } }) {
  if (!reportKeys.includes(params.report as (typeof reportKeys)[number])) notFound();
  return <ReportView key={params.report} report={params.report as (typeof reportKeys)[number]} />;
}
