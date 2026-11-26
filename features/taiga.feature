Feature: The Taiga plugin on the dashboard
  Once the plugin is activated and installed, the sites folders offer the Taiga builder, each AI folder lists the items
  of its kind the plugin ships, the Plugins page lists the plugin with its settings, and the project rows of sites and
  code folders carry the TAIGA menu of user stories once a Taiga is connected.

  # Settings lists every plugin that was added; the package and what the plugin ships are on its own page.
  Scenario: Settings lists the plugin, and its own page names its package, what it ships and its settings
    Given I am on "/settings"
     Then I should see "Taiga"
     When I go to "/settings/plugin/taiga"
     Then I should see "@webship.co/workspace-taiga"
      And I should see "cmd-taiga-project.sh"
      And I should see "taiga-site-builder"
      And I should see "Writes to Taiga (user stories)"

  Scenario: A sites folder offers the Taiga builder
    Given I am on "/dev"
     Then "option[value='cmd-taiga-project.sh']" should be attached

  # The AI folders are searched by name: with every plugin on, a folder lists more than one page of items.
  Scenario: The AI Agents folder lists the agents the plugin ships
    Given I am on "/ai-agents?q=taiga-"
     Then I should see "taiga-site-builder"
      And I should see "taiga-tester"
      And I should see "taiga-issue-worker"

  Scenario: The AI Skills folder lists the skill the plugin ships
    Given I am on "/ai-skills?q=taiga-scenarios"
     Then I should see "taiga-scenarios"

  Scenario: The AI Commands folder lists the command the plugin ships
    Given I am on "/ai-commands?q=taiga-test"
     Then I should see "taiga-test"

  Scenario: The AI Prompts folder lists the prompts the plugin ships
    Given I am on "/ai-prompts?q=taiga-"
     Then I should see "taiga-build-and-test"
      And I should see "taiga-issue-to-branch"

  # The user stories as work items (@webship.co/workspace-tracker). The list asks Taiga again when its View or its
  # filter changes, and Enter submits it; the current sprint is its iteration view. It needs a Taiga with a token, a
  # default project and a project in the dev folder: CI has none, so it skips this, saying why.
  @needs-setting-taiga-token @needs-setting-taiga-default_scope @needs-project-dev
  Scenario: The user story list follows its View, the current sprint among them, and its filter
    Given I am on "/dev"
     When I click on the element ".act-menu-taiga > button"
      And I click on the element ".act-menu-taiga a[hx-get*='/tracker/list/']"
     Then eventually I should see "All open user stories ·" within 30 seconds
     When I select "My user stories" from "view"
     Then eventually I should see "My user stories ·" within 30 seconds
     When I select "Current sprint" from "view"
     Then eventually I should see "Current sprint ·" within 30 seconds
      And I should see "The greeting script says Helo instead of Hello"
      And I should not see "The usage line spells greeting as greting"
     When I select "Search (Taiga's own syntax)" from "view"
      And I fill in "q" with "greting"
      And I press the key "Enter" on the element "input[name=q]"
     Then eventually I should see "Search (Taiga's own syntax) ·" within 30 seconds
      And I should see "The usage line spells greeting as greting"
      And I should not see "The greeting script says Helo instead of Hello"
