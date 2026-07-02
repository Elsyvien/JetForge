import { TxtJetIssueCode } from "./scanner";

export interface TxtJetTextEdit {
  start: number;
  end: number;
  newText: string;
}

export interface TxtJetCodeActionEdit {
  title: string;
  edit: TxtJetTextEdit;
}

export interface TxtJetCodeActionIssue {
  code: TxtJetIssueCode;
  start: number;
  end: number;
}

export function buildTxtJetCodeActionEdit(text: string, issue: TxtJetCodeActionIssue): TxtJetCodeActionEdit | undefined {
  switch (issue.code) {
    case "unexpected-close":
      return {
        title: "Remove unexpected TxtJet closing delimiter",
        edit: {
          start: issue.start,
          end: issue.end,
          newText: ""
        }
      };

    case "unclosed-block":
      return {
        title: "Insert missing TxtJet closing delimiter",
        edit: {
          start: text.length,
          end: text.length,
          newText: "%>"
        }
      };

    case "empty-directive":
      return {
        title: "Insert default TxtJet directive name",
        edit: {
          start: issue.start,
          end: issue.end,
          newText: " jet "
        }
      };

    case "malformed-directive":
      return malformedDirectiveFix(text, issue);

    case "unterminated-directive-string":
      return {
        title: "Insert missing directive quote",
        edit: {
          start: issue.end,
          end: issue.end,
          newText: quoteForUnterminatedString(text, issue)
        }
      };
  }
  return undefined;
}

function malformedDirectiveFix(text: string, issue: TxtJetCodeActionIssue): TxtJetCodeActionEdit | undefined {
  const token = text.slice(issue.start, issue.end);
  if (!token || /\s/.test(token)) {
    return undefined;
  }

  return {
    title: "Replace malformed directive name with jet",
    edit: {
      start: issue.start,
      end: issue.end,
      newText: "jet"
    }
  };
}

function quoteForUnterminatedString(text: string, issue: TxtJetCodeActionIssue): string {
  const quote = text[issue.start];
  return quote === "'" ? "'" : "\"";
}
