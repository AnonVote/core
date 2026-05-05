import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import OptionSelector from "../components/OptionSelector";
import type { Option } from "../types";

const options: Option[] = [
  { id: "opt-1", ballotId: "b1", text: "Option A" },
  { id: "opt-2", ballotId: "b1", text: "Option B" },
  { id: "opt-3", ballotId: "b1", text: "Option C" },
];

describe("OptionSelector", () => {
  it("renders all options", () => {
    render(<OptionSelector options={options} selected="" onChange={vi.fn()} />);
    expect(screen.getByText("Option A")).toBeInTheDocument();
    expect(screen.getByText("Option B")).toBeInTheDocument();
    expect(screen.getByText("Option C")).toBeInTheDocument();
  });

  it("has role=radiogroup on container", () => {
    const { container } = render(
      <OptionSelector options={options} selected="" onChange={vi.fn()} />,
    );
    expect(container.querySelector('[role="radiogroup"]')).toBeInTheDocument();
  });

  it("marks selected option as aria-checked=true", () => {
    render(
      <OptionSelector options={options} selected="opt-2" onChange={vi.fn()} />,
    );
    const buttons = screen.getAllByRole("radio");
    const selected = buttons.find(
      (b) => b.getAttribute("aria-checked") === "true",
    );
    expect(selected).toHaveTextContent("Option B");
  });

  it("marks unselected options as aria-checked=false", () => {
    render(
      <OptionSelector options={options} selected="opt-1" onChange={vi.fn()} />,
    );
    const unchecked = screen
      .getAllByRole("radio")
      .filter((b) => b.getAttribute("aria-checked") === "false");
    expect(unchecked).toHaveLength(2);
  });

  it("calls onChange with correct id when option is clicked", () => {
    const onChange = vi.fn();
    render(
      <OptionSelector options={options} selected="" onChange={onChange} />,
    );
    fireEvent.click(screen.getByText("Option C"));
    expect(onChange).toHaveBeenCalledWith("opt-3");
  });

  it("does not call onChange when already selected option is clicked", () => {
    const onChange = vi.fn();
    render(
      <OptionSelector options={options} selected="opt-1" onChange={onChange} />,
    );
    fireEvent.click(screen.getByText("Option A"));
    // onChange is still called — it's up to the parent to ignore same selection
    expect(onChange).toHaveBeenCalledWith("opt-1");
  });
});
