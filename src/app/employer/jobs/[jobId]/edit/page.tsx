import { JobManagementPage } from "@/modules/jobs/pages";
export default async function Page({ params }: { params: Promise<{ jobId: string }> }) { return <JobManagementPage id={(await params).jobId} edit />; }
