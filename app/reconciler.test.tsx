import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Reconciler from "./reconciler";

function setup() {
  const user = userEvent.setup();
  render(<Reconciler />);
  return {
    user,
    inputA: screen.getByLabelText(/step 1/i),
    inputB: screen.getByLabelText(/step 2/i),
    submitButton: screen.getByRole("button", { name: /reconcile/i }),
  };
}

// Note: navigator.clipboard is deliberately NOT stubbed globally here —
// @testing-library/user-event's own setup() installs its own clipboard
// stub for .copy()/.paste()/.cut() support, and it would clobber a mock
// assigned beforehand. The "copy to clipboard" test below installs its
// mock after calling setup() instead.

describe("initial state", () => {
  test("renders the heading and both inputs empty", () => {
    setup();
    expect(
      screen.getByRole("heading", { name: /html translation reconciler/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/step 1/i)).toHaveValue("");
    expect(screen.getByLabelText(/step 2/i)).toHaveValue("");
  });

  test("submit is disabled until both inputs are filled", async () => {
    const { user, inputA, submitButton } = setup();
    expect(submitButton).toBeDisabled();
    await user.type(inputA, "<p>Hello</p>");
    expect(submitButton).toBeDisabled();
  });

  test("whitespace-only input does not enable submit", async () => {
    const { user, inputA, inputB, submitButton } = setup();
    await user.type(inputA, "   ");
    await user.type(inputB, "   ");
    expect(submitButton).toBeDisabled();
  });

});

describe("reconcile flow", () => {
  test("matched paragraph counts produce a result with no warnings", async () => {
    const { user, inputA, inputB, submitButton } = setup();
    await user.type(inputA, "<p>Hello world.</p>");
    await user.type(inputB, "Bonjour le monde.");
    expect(submitButton).toBeEnabled();
    await user.click(submitButton);

    const output = await screen.findByLabelText(/reconciled html output/i);
    expect(output).toHaveValue("<p>Bonjour le monde.</p>");
    expect(
      screen.queryByText(/aligned automatically/i),
    ).not.toBeInTheDocument();
  });

  test("mismatched block counts surface a warning alongside the result", async () => {
    const { user, inputA, inputB, submitButton } = setup();
    await user.type(inputA, "<p>Intro paragraph.</p><p>Body paragraph.</p>");
    // fireEvent-free typing of a multi-line value via userEvent needs
    // literal newlines escaped for the key-sequence parser.
    await user.type(inputB, "Introduction.{Enter}Nouveau titre.{Enter}Corps du texte.");
    await user.click(submitButton);

    const output = await screen.findByLabelText(/reconciled html output/i);
    expect(output.value).toContain("Nouveau titre");
    expect(screen.getByText(/aligned automatically/i)).toBeInTheDocument();
  });

  test("clicking reconcile again after editing inputs updates the result", async () => {
    const { user, inputA, inputB, submitButton } = setup();
    await user.type(inputA, "<p>Hello.</p>");
    await user.type(inputB, "Bonjour.");
    await user.click(submitButton);
    await screen.findByLabelText(/reconciled html output/i);

    await user.clear(inputB);
    await user.type(inputB, "Salut.");
    await user.click(submitButton);

    const output = await screen.findByLabelText(/reconciled html output/i);
    expect(output).toHaveValue("<p>Salut.</p>");
  });

  test("shows an inline error and preserves inputs when reconciliation throws", async () => {
    const { user, inputA, inputB, submitButton } = setup();
    // <p></p> has no text content, which reconcile() rejects.
    await user.type(inputA, "<p></p>");
    await user.type(inputB, "Some translated text.");
    await user.click(submitButton);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /no text content/i,
    );
    expect(inputA).toHaveValue("<p></p>");
    expect(inputB).toHaveValue("Some translated text.");
  });

  test("retry re-runs the reconciliation after fixing the input", async () => {
    const { user, inputA, inputB, submitButton } = setup();
    await user.type(inputA, "<p></p>");
    await user.type(inputB, "Some text.");
    await user.click(submitButton);
    await screen.findByRole("alert");

    await user.clear(inputA);
    await user.type(inputA, "<p>Fixed now.</p>");
    await user.click(screen.getByRole("button", { name: /retry/i }));

    const output = await screen.findByLabelText(/reconciled html output/i);
    expect(output).toHaveValue("<p>Some text.</p>");
  });
});

describe("soft HTML-in-plain-text warning", () => {
  test("warns when Step 2 looks like it contains HTML tags", async () => {
    const { user, inputB } = setup();
    await user.type(inputB, "<p>Oops, pasted HTML here</p>");
    expect(
      screen.getByText(/did you mean to paste it in step 1/i),
    ).toBeInTheDocument();
  });

  test("does not warn for plain text", async () => {
    const { user, inputB } = setup();
    await user.type(inputB, "Just plain translated text.");
    expect(
      screen.queryByText(/did you mean to paste it in step 1/i),
    ).not.toBeInTheDocument();
  });
});

describe("character cap", () => {
  test("blocks submit and shows a warning once a field exceeds the cap", async () => {
    const { user, inputA, inputB, submitButton } = setup();
    const overCap = "a".repeat(500001);
    // Programmatic paste avoids simulating 500k+ individual keystrokes.
    await user.click(inputA);
    await user.paste(overCap);
    await user.type(inputB, "Some short translation.");

    expect(
      screen.getByText(/exceeds the 500,000 character limit/i),
    ).toBeInTheDocument();
    expect(submitButton).toBeDisabled();
  });
});

describe("copy to clipboard", () => {
  test("copies the result and shows a transient confirmation", async () => {
    const { user, inputA, inputB, submitButton } = setup();
    await user.type(inputA, "<p>Hello.</p>");
    await user.type(inputB, "Bonjour.");
    await user.click(submitButton);
    await screen.findByLabelText(/reconciled html output/i);

    const writeTextMock = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      configurable: true,
    });

    const copyButton = screen.getByRole("button", {
      name: /copy to clipboard/i,
    });
    await user.click(copyButton);

    expect(writeTextMock).toHaveBeenCalledWith("<p>Bonjour.</p>");
    expect(await screen.findByText(/copied/i)).toBeInTheDocument();
  });
});

describe("diff view", () => {
  test("shows a collapsed diff toggle after a successful reconcile", async () => {
    const { user, inputA, inputB, submitButton } = setup();
    await user.type(inputA, "<p>Hello world.</p>");
    await user.type(inputB, "Bonjour le monde.");
    await user.click(submitButton);
    await screen.findByLabelText(/reconciled html output/i);

    const details = screen.getByText(/show diff from original html/i)
      .closest("details") as HTMLDetailsElement;
    expect(details).not.toBeNull();
    expect(details.open).toBe(false);

    await user.click(within(details).getByText(/show diff from original html/i));
    expect(details.open).toBe(true);
    expect(details).toHaveTextContent("Hello");
    expect(details).toHaveTextContent("Bonjour");
  });
});
