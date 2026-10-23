/**
 * 每次后台内导航都会新建一个 template 实例，用来播放入场动画。
 * 内容流式返回时也会一并淡入，避免「页面卡住不动」的错觉。
 */
export default function AdminTemplate({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="animate-rise">{children}</div>;
}
