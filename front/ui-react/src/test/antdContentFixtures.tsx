import type { MouseEventHandler, ReactNode } from 'react';

interface FixtureColumn<Row> {
  readonly key?: string;
  readonly dataIndex?: keyof Row;
  readonly render?: (value: Row[keyof Row] | undefined, row: Row, index: number) => ReactNode;
}

// Render the supplied row and cell content without AntD's measurement or CSS.
export function FixtureTable<Row extends object>({
  columns,
  dataSource = [],
  rowKey,
}: {
  columns: readonly FixtureColumn<Row>[];
  dataSource?: readonly Row[];
  rowKey?: keyof Row;
}) {
  return (
    <table>
      <tbody>
        {dataSource.map((row, index) => {
          const id = rowKey === undefined ? index : String(row[rowKey]);
          return (
            <tr key={id} data-row-key={id}>
              {columns.map(({ key, dataIndex, render }, columnIndex) => {
                const value = dataIndex === undefined ? undefined : row[dataIndex];
                return <td key={key ?? columnIndex}>{render ? render(value, row, index) : String(value ?? '')}</td>;
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function FixtureTabs({
  items = [],
  activeKey = items[0]?.key,
}: {
  items?: readonly { key: string; children?: ReactNode }[];
  activeKey?: string;
}) {
  return <>{items.find((item) => item.key === activeKey)?.children}</>;
}

export function FixtureButton({
  children,
  title,
  disabled,
  loading,
  onClick,
}: {
  children?: ReactNode;
  title?: string;
  disabled?: boolean;
  loading?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
}) {
  return (
    <button type="button" title={title} disabled={disabled || loading} onClick={onClick}>
      {children}
    </button>
  );
}
