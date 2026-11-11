import {
  Children,
  cloneElement,
  createContext,
  forwardRef,
  isValidElement,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ComponentRef,
  type ComponentType,
  type HTMLAttributes,
  type ReactElement,
  type RefAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Tabs, type TabsProps } from 'antd';
import './AccessibleTabs.css';

type RenderTabBar = NonNullable<TabsProps['renderTabBar']>;
type BarProps = Parameters<RenderTabBar>[0];
type DefaultBar = Parameters<RenderTabBar>[1];
type TabNode = ReactElement<HTMLAttributes<HTMLDivElement>>;
type CloseButton = ReactElement<ComponentProps<'button'>>;
interface BarContext {
  nav: HTMLDivElement;
  host: HTMLDivElement;
  listeners: Set<() => void>;
}
const Context = createContext<BarContext | null>(null);

function ExternalClose({ node }: { node: TabNode }) {
  const context = useContext(Context);
  const placeholder = useRef<HTMLButtonElement>(null);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const children = Children.toArray(node.props.children);
  const removeIndex = children.findIndex((child) => isValidElement(child) && child.type === 'button');
  const remove = children[removeIndex] as CloseButton | undefined;
  const removable = removeIndex >= 0;

  useLayoutEffect(() => {
    if (!context || !removable) return;
    const measure = () => {
      const slot = placeholder.current;
      const clip = context.nav.querySelector('.ant-tabs-nav-wrap');
      if (!slot || !clip) return;
      const rect = slot.getBoundingClientRect();
      const bounds = clip.getBoundingClientRect();
      const origin = context.nav.getBoundingClientRect();
      const visible =
        rect.width > 0 &&
        rect.height > 0 &&
        rect.left >= bounds.left - 0.5 &&
        rect.right <= bounds.right + 0.5 &&
        rect.top >= bounds.top - 0.5 &&
        rect.bottom <= bounds.bottom + 0.5;
      const next = visible
        ? { left: rect.left - origin.left, top: rect.top - origin.top, width: rect.width, height: rect.height }
        : null;
      setBox((current) =>
        current?.left === next?.left &&
        current?.top === next?.top &&
        current?.width === next?.width &&
        current?.height === next?.height
          ? current
          : next,
      );
    };
    context.listeners.add(measure);
    measure();
    return () => {
      context.listeners.delete(measure);
    };
  }, [context, removable]);

  if (!remove || !context) return node;
  // A disabled, invisible copy reserves native button metrics, including UA
  // padding. The operable button is a separate portal outside the tablist.
  children[removeIndex] = cloneElement(remove, {
    key: 'close-slot',
    ref: placeholder,
    disabled: true,
    tabIndex: -1,
    'aria-hidden': true,
    onClick: undefined,
    style: { ...remove.props.style, visibility: 'hidden', pointerEvents: 'none' },
  });
  return cloneElement(
    node,
    undefined,
    children,
    createPortal(
      <div className="knife4j-tab-close-control" style={{ ...box, display: box ? undefined : 'none' }}>
        {cloneElement(remove, {
          style: { ...remove.props.style, margin: 0, width: '100%', height: '100%', boxSizing: 'border-box' },
        })}
      </div>,
      context.host,
    ),
  );
}

function TabBar({ props, DefaultTabBar, label }: { props: BarProps; DefaultTabBar: DefaultBar; label: string }) {
  const [nav, setNav] = useState<HTMLDivElement | null>(null);
  const [context, setContext] = useState<BarContext | null>(null);
  // The public renderTabBar factory supplies rc-tabs' forwarded-ref nav component.
  const Bar = DefaultTabBar as ComponentType<
    BarProps &
      RefAttributes<HTMLDivElement> & {
        children?: (node: TabNode) => ReactElement;
      }
  >;

  useLayoutEffect(() => {
    if (!nav) return;
    const list = nav.querySelector<HTMLElement>('.ant-tabs-nav-list');
    if (!list) return;
    const orientation = props.tabPosition === 'left' || props.tabPosition === 'right' ? 'vertical' : 'horizontal';
    const host = document.createElement('div');
    host.className = 'knife4j-tab-controls';
    nav.append(host);
    const listeners = new Set<() => void>();
    const repairGroup = () => {
      if (nav.hasAttribute('role')) nav.removeAttribute('role');
      if (nav.hasAttribute('aria-orientation')) nav.removeAttribute('aria-orientation');
      if (list.getAttribute('role') !== 'tablist') list.setAttribute('role', 'tablist');
      if (list.getAttribute('aria-label') !== label) list.setAttribute('aria-label', label);
      if (list.getAttribute('aria-orientation') !== orientation) list.setAttribute('aria-orientation', orientation);
    };
    let frame = 0;
    let deadline = 0;
    const tick = () => {
      repairGroup();
      listeners.forEach((listener) => listener());
      frame = performance.now() < deadline ? requestAnimationFrame(tick) : 0;
    };
    // rc-tabs scrolls by animating a transform. Follow that animation as well as
    // resize, touch scrolling and label changes; the controls must share its clip.
    const schedule = () => {
      repairGroup();
      deadline = performance.now() + 400;
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const observer = new MutationObserver((records) => {
      if (records.some((record) => !host.contains(record.target))) schedule();
    });
    observer.observe(nav, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'role'],
    });
    const resize = new ResizeObserver(schedule);
    resize.observe(nav);
    resize.observe(list);
    nav.addEventListener('scroll', schedule, true);
    repairGroup();
    setContext({ nav, host, listeners });
    schedule();
    return () => {
      observer.disconnect();
      resize.disconnect();
      nav.removeEventListener('scroll', schedule, true);
      cancelAnimationFrame(frame);
      listeners.clear();
      host.remove();
      nav.setAttribute('role', 'tablist');
      nav.setAttribute('aria-orientation', orientation);
      list.removeAttribute('role');
      list.removeAttribute('aria-label');
      list.removeAttribute('aria-orientation');
    };
  }, [label, nav, props.tabPosition]);

  return (
    <Context.Provider value={context}>
      <Bar {...props} ref={setNav}>
        {(node) => <ExternalClose node={node} />}
      </Bar>
    </Context.Provider>
  );
}

interface AccessibleTabsProps extends Omit<TabsProps, 'renderTabBar'> {
  tabListLabel: string;
}

// Keep Ant's tab refs, selection, keyboard handling, menu and panel associations.
// Only its semantic grouping and close-button placement need adaptation. React
// owns the external buttons through portals; never reparent its existing DOM.
const AccessibleTabs = forwardRef<ComponentRef<typeof Tabs>, AccessibleTabsProps>(function AccessibleTabs(
  { tabListLabel, ...props },
  ref,
) {
  return (
    <Tabs
      {...props}
      ref={ref}
      renderTabBar={(barProps, DefaultTabBar) => (
        <TabBar props={barProps} DefaultTabBar={DefaultTabBar} label={tabListLabel} />
      )}
    />
  );
});

export default AccessibleTabs;
