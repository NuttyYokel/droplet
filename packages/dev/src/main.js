import appleTemplate from './apple.html';
import { default as mainTemplate } from './main.html';
let body = document.querySelectorAll('body')[0];

//-----------------------------html parsing--------------------------------
function createDOMNodeFromHTML(htmlString) {
  let div = document.createElement('div');
  div.innerHTML = htmlString;
  return div.firstElementChild;
}

function createNodefromDOMNode(DOMNode, componentsList) {
  let node;
  if (DOMNode.attributes.hasOwnProperty('*if')) {
    node = buildIfNode(DOMNode, componentsList);
  } else if (DOMNode.attributes.hasOwnProperty('*for')) {
    node = buildForNode(DOMNode, componentsList);
  } else {
    node = buildNormalNode(DOMNode, componentsList);
  }

  return node;
}

function buildNormalNode(DOMNode, componentsList) {
  let node = {
    elementName: DOMNode.nodeName,
    attributes: {},
    children: [],
    DOMNode,
    component: componentsList[DOMNode.nodeName],
  };

  initializeNodeAttributes(node);

  if (node.component) {
    initializeNodeComponent(node);
  } else {
    initializeChildNodes(node, componentsList);
  }

  return node;
}

function buildIfNode(DOMNode, componentsList) {
  let expression = DOMNode.attributes['*if'].value;
  DOMNode.removeAttribute('*if');
  let node = {
    elementName: '*if',
    expression,
    active: null,
    placeholder: document.createTextNode(''),
    content: createNodefromDOMNode(DOMNode, componentsList),
  };

  DOMNode.replaceWith(node.placeholder);
  return node;
}

function buildForNode(DOMNode, componentsList) {
  let expression = DOMNode.attributes['*for'].value;
  DOMNode.removeAttribute('*for');
  let node = {
    elementName: '*for',
    expression,
    elements: {},
    placeholder: document.createTextNode(''),
    content: createNodefromDOMNode(DOMNode, componentsList),
  };

  DOMNode.replaceWith(node.placeholder);
  return node;
}

function initializeNodeAttributes(node) {
  Object.keys(node.DOMNode.attributes).forEach((key) => {
    let attribute = node.DOMNode.attributes[key];
    node.attributes[attribute.name] = attribute.value;
    if (attribute.name.startsWith('on')) {
      node.DOMNode[attribute.name] = null;
    }
  });
}

function initializeNodeComponent(node) {
  node.instance = new node.component();
  while (node.DOMNode.firstChild) {
    node.DOMNode.removeChild(node.DOMNode.firstChild);
  }
  node.DOMNode.appendChild(node.instance.template.DOMNode);
  node.children.push(node.instance.template);
}

function initializeChildNodes(node, componentsList) {
  Object.keys(node.DOMNode.childNodes).forEach((key) => {
    let child = buildChildNode(node.DOMNode.childNodes[key], componentsList);
    if (child) {
      node.children.push(child);
    }
  });
}

function buildChildNode(DOMNode, componentsList) {
  let nodeName = DOMNode.nodeName;
  if (nodeName === '#text') {
    let text = DOMNode.nodeValue.replace(/(\n|\r)/gm, '').trim();
    if (text) {
      return { text, DOMNode };
    }
  } else if (!nodeName.startsWith('#')) {
    return createNodefromDOMNode(DOMNode, componentsList);
  }
  return null;
}

function html2json(html, componentsList) {
  return createNodefromDOMNode(createDOMNodeFromHTML(html), componentsList);
}

//-----------------------------update logic--------------------------------
let processQueue = new Set();
let renderQueue = new Set();

function getObjectAttribute(object, attribute) {
  let value = object;
  let properties = attribute.split('.');

  for (let property of properties) {
    value = value[property];
  }

  return value;
}

function updateNode({ node, object }) {
  if (node.elementName === '*if') {
    updateIfNode(node, object);
  }

  if (node.elementName === '*for') {
    updateForNode(node, object);
  }

  if (node.text) {
    updateTextNode(node, object);
    return;
  }

  if (node.attributes) {
    object = updateNodeAttributes(node, object);
  }

  if (node.children) {
    node.children.forEach((child) => {
      processQueue.add({
        node: child,
        object,
      });
    });
  }
}

function updateNodeAttributes(node, object) {
  Object.keys(node.attributes).forEach((attribute) => {
    let value = node.attributes[attribute];
    if (value[0] === '{') {
      value = value.substring(1, value.length - 1);
      if (value[value.length - 1] === ')') {
        value = object[value.substring(0, value.length - 2)]();
      } else {
        value = getObjectAttribute(object, value);
      }

      if (attribute.startsWith('on')) {
        if (!node.DOMNode[attribute]) {
          node.newDOMNode = node.DOMNode.cloneNode(false);
          node.newDOMNode.removeAttribute(attribute);
          node.newDOMNode[attribute] = value;
          renderQueue.add(node);
        }
      } else if (getObjectAttribute(node.DOMNode, attribute) !== value) {
        node.newDOMNode = node.DOMNode.cloneNode(false);
        node.newDOMNode.setAttribute(attribute, value);
        renderQueue.add(node);
      }

      if (node.component) {
        node.instance.inputs[attribute] = value;
      }
    }
  });

  if (node.component) {
    object = node.instance;
  }
  return object;
}

function printLinkedList(pointer) {
  let out = [];
  while (pointer) {
    if (pointer.key) {
      out.push(pointer.key);
    }
    pointer = pointer.next;
  }
  console.log(out);
}

function updateForNode(node, object) {
  let [iterator, list] = node.expression.split(' of ');

  let objectAttribute = getObjectAttribute(object, list);
  list =
    typeof objectAttribute == 'function' ? objectAttribute() : objectAttribute;
  node.list = list;

  let { updates, deletions, additions } = updateForLoopElements(
    node.elements,
    list
  );

  // console.log('##################################################');
  // console.log(updates.map(a=>a.key));
  // console.log(deletions.map(a=>a.key));
  // console.log(additions.map(a=>a.key));
  // console.log('--------------------------------------------------');

  printLinkedList(node.elements);

  //add the stuff
  for (let i = additions.length - 1; i >= 0; i--) {
    if (additions[i].content.insertAfterNode) {
      additions[i].content.insertAfterNode =
        additions[i].content.insertAfterNode.DOMNode;
    } else {
      additions[i].content.insertAfterNode = node.placeholder;
    }
    if (!additions[i].content.DOMNode) {
      additions[i].content = {
        ...additions[i].content,
        // merge with for variables
        ...duplicateNode(node.content),
      };
      renderQueue.add(additions[i].content);
    }
  }

  for (let i = 0; i < deletions.length; i++) {
    deletions[i].content.toBeDeleted = true;
    renderQueue.add(deletions[i].content);
  }

  for (let i = 0; i < updates.length; i++) {
    updateNode({
      node: updates[i].content,
      object: { ...node.content, [iterator]: updates[i].key },
    });
  }
}

function updateForLoopElements(elementPointer, list) {
  let i = 0;
  let updates = [];
  let deletions = [];
  let additions = [];
  let lastExistingElement = elementPointer;
  while (i < list.length) {
    let inBetween = [elementPointer];
    let searchPointer = elementPointer.next;
    while (searchPointer && searchPointer.key !== list[i]) {
      inBetween.push(searchPointer);
      searchPointer = searchPointer.next;
    }
    if (searchPointer) {
      if (inBetween.length > 1) {
        deletions.push(...inBetween.slice(1, inBetween.length));
      }
      elementPointer.next = searchPointer;
      elementPointer = searchPointer;
      lastExistingElement = searchPointer;
      updates.push(searchPointer);
    } else {
      let newElement = {
        key: list[i],
        next: elementPointer.next,
        content: { insertAfterNode: lastExistingElement.content },
      };
      let alreadyExistingElementIndex = deletions.findIndex(
        (element) => element.key === list[i]
      );
      if (alreadyExistingElementIndex > -1) {
        newElement.content = {
          ...newElement.content,
          ...deletions.splice(alreadyExistingElementIndex, 1)[0].content,
        };
      }
      elementPointer.next = newElement;
      elementPointer = newElement;
      additions.push(newElement);
    }
    i++;
  }

  let inBetween = [elementPointer];
  let searchPointer = elementPointer.next;
  while (searchPointer && searchPointer.key !== list[i]) {
    inBetween.push(searchPointer);
    searchPointer = searchPointer.next;
  }
  if (inBetween.length > 1) {
    deletions.push(...inBetween.slice(1, inBetween.length));
  }
  elementPointer.next = null;

  return { updates, deletions, additions };
}

function duplicateNode(content, parentNode) {
  let newContent = {
    ...content,
    children: [],
    DOMNode: content.DOMNode.cloneNode(false),
    newDOMNode: content.DOMNode.cloneNode(false),
  };
  if (parentNode) {
    parentNode.appendChild(newContent.DOMNode);
  }
  if (content.children) {
    newContent.children = content.children.map((child) =>
      duplicateNode(child, newContent.DOMNode)
    );
  }
  return newContent;
}

function updateIfNode(node, object) {
  let field = node.expression;
  let directLogic = true;
  if (field[0] === '!') {
    directLogic = false;
    field = field.substring(1);
  }

  if (!object.hasOwnProperty(field)) {
    console.warn(
      `Possible template issue: the field ${field} is not part of the object ${object.constructor.name}.`
    );
  }

  let objectAttribute = getObjectAttribute(object, field);
  let isTrue =
    typeof objectAttribute == 'function' ? objectAttribute() : objectAttribute;
  if (isTrue == directLogic) {
    if (node.oldDOMNode && node.active !== true) {
      node.active = true;
      node.content.newDOMNode = node.oldDOMNode;
      node.content.skipChildren = false;
      renderQueue.add(node.content);
    }
  } else if (node.active !== false) {
    node.active = false;
    node.oldDOMNode = node.content.DOMNode;
    node.content.newDOMNode = node.placeholder;
    node.content.skipChildren = true;
    renderQueue.add(node.content);
  }

  if (node.active || node.active === null) {
    updateNode({ node: node.content, object });
  }
}

function updateTextNode(node, object) {
  let text = insertFieldsIntoString(node.text, object);
  if (node.DOMNode.nodeValue !== text) {
    node.newDOMNode = node.DOMNode.cloneNode(false);
    node.newDOMNode.nodeValue = text;
    renderQueue.add(node);
  }
}

function insertFieldsIntoString(string = '', object = {}) {
  let sections = string.split('}');
  let fields = {};

  for (let section of sections) {
    let field = section.split('{')[1];
    if (field) {
      fields[field] = getObjectAttribute(object, field);
    }
  }

  Object.keys(fields).forEach((key) => {
    string = string.replace(
      new RegExp(`{${key}}`, 'g'),
      getObjectAttribute(object, key)
    );
  });

  return string;
}

function renderNode(node) {
  if (node.toBeDeleted) {
    node.DOMNode.remove();
    node.toBeDeleted = false;
  } else if (node.insertAfterNode) {
    node.insertAfterNode.after(node.DOMNode);
    node.insertAfterNode = null;
  } else {
    if (!node.skipChildren && node.children) {
      node.children.forEach((child) => {
        node.newDOMNode.appendChild(child.DOMNode);
      });
    }
    node.DOMNode.replaceWith(node.newDOMNode);
    node.DOMNode = node.newDOMNode;
  }
}

function workLoop(deadline) {
  let thereIsStillTime = true;
  while (processQueue.size && thereIsStillTime) {
    let elementToProcess = processQueue.entries().next().value[0];
    processQueue.delete(elementToProcess);
    updateNode(elementToProcess);

    thereIsStillTime = deadline.timeRemaining() > 0;
  }
  while (renderQueue.size && thereIsStillTime) {
    let elementToRender = renderQueue.entries().next().value[0];
    renderQueue.delete(elementToRender);
    renderNode(elementToRender);

    thereIsStillTime = deadline.timeRemaining() > 0;
  }

  requestIdleCallback(workLoop);
}

requestIdleCallback(workLoop);

//----------------------------component logic------------------------------
let componentsList = {};

function toUpperKebabCase(camelCase = '') {
  let nameArray = camelCase.split('');
  for (let i = 1; i < nameArray.length; i++) {
    if (nameArray[i] >= 'A' && nameArray[i] <= 'Z') {
      nameArray.splice(i, 1, '-' + nameArray[i]);
    }
  }
  return nameArray.join('').toUpperCase();
}

function loadComponents(...components) {
  components.forEach((component) => {
    componentsList[toUpperKebabCase(component.name)] = component;
  });
}

function createProxy(object) {
  return new Proxy(object, {
    set(target, name, value) {
      target[name] = value;
      processQueue.add({
        node: object.template,
        object,
      });
      return true;
    },
  });
}

function bindClassMethodsToProxy(object, proxy) {
  let methods = Object.getOwnPropertyNames(Object.getPrototypeOf(object));
  methods.forEach((method) => {
    if (typeof object[method] === 'function' && method !== 'constructor') {
      object[method] = object[method].bind(proxy);
    }
  });
}

class Component {
  inputs = {};
  constructor(template) {
    this.template = html2json(template, componentsList);
    this.proxy = createProxy(this);
    bindClassMethodsToProxy(this, this.proxy);
    return this.proxy;
  }
}

class Apple extends Component {
  constructor() {
    super(appleTemplate);
  }

  decrease() {
    this.inputs['content-change'](2);
  }
}

class Main extends Component {
  count = 0;
  as = [];
  something = 0;
  test = [
    [1],
    [1, 2],
    [1, 2, 3],
    [1, 3, 2],
    [1, 3, 3],
    [1, 1, 1],
    [2, 2, 2],
    [3, 3, 3],
    [3, 1, 3],
    [3, 1, 2],
    [3, 1],
    [3],
  ];

  constructor() {
    super(mainTemplate);
    this.as = this.test[this.count];
  }

  length() {
    return this.as.length;
  }

  isOdd() {
    return this.count % 2;
  }

  addA() {
    this.count = (this.count + 1) % 12;
    this.as = this.test[this.count];
  }

  removeA() {
    this.as.splice(Math.floor(Math.random() * this.as.length), 1);
    this.as = [...this.as];
  }

  changeSomething() {
    this.something = Math.floor(Math.random() * 90 + 10);
  }
}

loadComponents(Main, Apple);
let main = new Main();
body.appendChild(main.template.DOMNode);
console.log(main);

//----------------------------------keep-----------------------------------
function getListDiffs(old, current) {
  let deleted = {};
  let created = {};
  if (old[0] instanceof Object) {
    for (let i = 0; i < old.length; i++) {
      deleted[JSON.stringify(old[i])] = old[i];
    }
    for (let i = 0; i < current.length; i++) {
      if (deleted[JSON.stringify(current[i])]) {
        delete deleted[JSON.stringify(current[i])];
      } else {
        created[JSON.stringify(current[i])] = current[i];
      }
    }
  } else {
    for (let i = 0; i < old.length; i++) {
      deleted[old[i]] = old[i];
    }
    for (let i = 0; i < current.length; i++) {
      if (deleted[current[i]]) {
        delete deleted[current[i]];
      } else {
        created[current[i]] = current[i];
      }
    }
  }
  return { deleted, created };
}

//--------------------------free stuff-----------------------
