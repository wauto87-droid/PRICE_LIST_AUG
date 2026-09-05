import CustomerQuotation from "@/frontend/CustomerQuotation";
export default async function CustomerQuotationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <CustomerQuotation token={token} />;
}
