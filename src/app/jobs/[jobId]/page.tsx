import { PublicJobPage } from "@/modules/jobs/pages";
export default async function Page({ params }: { params: Promise<{ jobId: string }> }) { return <PublicJobPage id={(await params).jobId} />; }
